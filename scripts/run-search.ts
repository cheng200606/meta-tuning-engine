// M3 配置搜索 CLI（迭代 2 重写执行路径）
// - --dry-run：零 API、无密钥，打印配置枚举 / 轮次计划 / 预算估算与门禁状态；
// - --self-test：注入确定性假 runner，零 API 端到端验证三件套产物规范；
// - --execute：真实跑批，需冻结校验 + 30 任务 + 组长批准留痕 + .env 密钥；
//   产物严格按 experiments/README.md 三件套落盘，infra_error 按协议 §2 处理。
// 纪律：M3 真实跑批会消耗预算，本脚本不自动执行；--execute 必须显式给 --approval。
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { configId, enumerateConfigs, type AgentConfig, type Availability } from '@meta-tuning/action-space'
import {
  createArtifactWriter, validateArtifacts,
  type ArtifactValidation, type SearchEpisodeRecord, type SnapshotMeta,
} from '../packages/search/src/artifacts.ts'
import { DEFAULT_WEIGHTS } from '../packages/search/src/index.ts'
import {
  equalBudgetRandom, mulberry32, successiveHalving,
  type EpisodeMetrics, type EpisodeRunner, type HalvingRound,
} from '../packages/search/src/halving.ts'
import { runEpisode } from '../packages/runner/src/index.ts'
import { MockTools } from '../packages/runner/src/mock-tools.ts'
import { fixturesByTask as g0Fixtures } from '../tasks/g0/env/fixtures.ts'
import { checkers as g0Checkers } from '../tasks/g0/checks/index.ts'
import { checkers as devCheckers } from '../tasks/dev/checks/index.ts'
import { fixturesByTask as devFixtures } from '../tasks/dev/env/fixtures.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROTOCOL_REF = '开发实验方案.md §6.2/§6.3 + experiments/README.md'
const REQUIRED_TASK_COUNT = 30

interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
interface ManifestTask {
  id: string
  category: 'tool' | 'reasoning' | 'code'
  instruction: string
  fixtures?: string[]
  tools_expected?: string[]
  expected?: string
}

const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases
const availability = (loadYaml(readFileSync(path.join(root, 'configs/availability.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: Record<string, Availability> }).bases

const g0ManifestPath = path.join(root, 'tasks/g0/tasks.manifest.json')
const devManifestPath = path.join(root, 'tasks/dev/manifest.json')
const g0Manifest = JSON.parse(readFileSync(g0ManifestPath, 'utf8')) as { tasks: ManifestTask[] }
const devManifest = JSON.parse(readFileSync(devManifestPath, 'utf8')) as { tasks: ManifestTask[] }
const g0Hash = createHash('sha256').update(readFileSync(g0ManifestPath)).digest('hex')
const devHash = createHash('sha256').update(readFileSync(devManifestPath)).digest('hex')
const allTasks: ManifestTask[] = [...g0Manifest.tasks, ...devManifest.tasks]
const fixtures = { ...g0Fixtures, ...devFixtures }

const DEFAULT_ROUND_SPECS = [
  { keep: 9, tasks: 6, seeds: [0] },
  { keep: 3, tasks: 12, seeds: [0, 1] },
  { keep: 1, tasks: 30, seeds: [0, 1, 2] },
]

/** 冻结校验：G0 manifest 的 sha256 必须与已冻结协议中记录的完全一致。 */
function assertFrozenG0(): void {
  const protocol = readFileSync(path.join(root, 'docs/g0-protocol.md'), 'utf8')
  const match = protocol.match(/清单 sha256 \| `([a-f0-9]{64})`/)
  if (match === null) throw new Error('frozen g0 manifest hash not found in docs/g0-protocol.md')
  if (match[1] !== g0Hash) {
    throw new Error(`g0 manifest sha256 mismatch: manifest=${g0Hash} protocol=${match[1]} — 冻结资产被改动，拒绝运行`)
  }
}

function buildRounds(configCount: number, taskCount: number): { rounds: HalvingRound[]; warnings: string[]; estimatedEpisodes: number } {
  const warnings: string[] = []
  if (taskCount < DEFAULT_ROUND_SPECS[DEFAULT_ROUND_SPECS.length - 1].tasks) {
    warnings.push(`任务集仅 ${taskCount} 个（目标 ${REQUIRED_TASK_COUNT}）：轮次按现有任务数执行，dev 集补齐后重跑`)
  }
  const rounds: HalvingRound[] = []
  let estimated = 0
  let survivors = configCount
  for (const r of DEFAULT_ROUND_SPECS) {
    const nTasks = Math.min(r.tasks, taskCount)
    const keep = Math.min(r.keep, survivors)
    rounds.push({ keep, tasks: allTasks.slice(0, nTasks).map((t) => ({ id: t.id })), seeds: r.seeds })
    estimated += survivors * nTasks * r.seeds.length
    survivors = keep // 保守估算：并列保留会使实际 episode 更多
  }
  return { rounds, warnings, estimatedEpisodes: estimated }
}

type EpisodeSource = (config: AgentConfig, taskId: string, seed: number) => Promise<{
  record: SearchEpisodeRecord
  metrics: EpisodeMetrics
  /** 本次是否发生过 infra_error 补跑（无论补跑成败都留痕）。 */
  rerun: boolean
  /** 第一次 infra_error 的原始原因（补跑成功后仍须留痕，不能用最终 record 覆盖）。 */
  infraReason: string | null
}>

function toMetrics(record: SearchEpisodeRecord): EpisodeMetrics {
  return {
    success: record.success === true,
    tool_accuracy: record.tool_calls === 0 ? 1 : 1 - record.tool_errors / record.tool_calls,
    steps: record.steps,
    cost: record.prompt_tokens + record.completion_tokens,
  }
}

/** 真实执行器：每 episode 独立 MockTools（环境重置）；infra_error 按协议 §2 补跑一次并留痕。 */
function realEpisodeSource(base: BaseConfig): EpisodeSource {
  const apiKey = process.env[base.api_key_env]
  if (!apiKey) throw new Error(`missing env ${base.api_key_env}（--execute 需要 .env 密钥）`)
  return async (config, taskId, seed) => {
    const task = allTasks.find((t) => t.id === taskId)
    if (task === undefined) throw new Error(`unknown task ${taskId}`)
    const checker = devCheckers[taskId] ?? g0Checkers[taskId]
    if (checker === undefined) throw new Error(`missing checker for ${taskId}`)
    const ctx = { baseId: base.id, baseUrl: base.base_url, apiKey, model: base.model, config, seed }
    const check = (fs: MockTools['fs'], finalAnswer: string) => checker({ fs, finalAnswer, toolCalls: 0, toolErrors: 0 })
    const run = () => runEpisode(task, ctx, check, new MockTools(fixtures[taskId] ?? {}))
    let record = await run()
    let rerun = false
    let infraReason: string | null = null
    if (record.success === 'infra_error') {
      infraReason = record.failure_reason
      console.warn(`[infra_error] rerun once: ${taskId} ${base.id} ${configId(config)} seed=${seed} (${record.failure_reason ?? 'unknown'})`)
      rerun = true
      record = await run()
    }
    return { record, metrics: toMetrics(record), rerun, infraReason }
  }
}

/** 自测执行器：完全确定性、零 API，用于验证产物链路而非算法结论。 */
function fakeEpisodeSource(): EpisodeSource {
  return async (config, taskId, seed) => {
    const cid = configId(config)
    const success = (cid.length + taskId.length + seed) % 3 !== 0
    const record: SearchEpisodeRecord = {
      task_id: taskId, base: 'self-test', config_id: cid, seed,
      success, steps: 2, tool_calls: 1, tool_errors: success ? 0 : 1,
      prompt_tokens: 100, completion_tokens: 50, latency_ms: 1,
      failure_reason: success ? null : 'self-test negative case', trace_path: null,
    }
    return { record, metrics: toMetrics(record), rerun: false, infraReason: null }
  }
}

class InfraAbort extends Error {}

interface RunOptions {
  method: 'halving' | 'random'
  base: BaseConfig
  configs: AgentConfig[]
  rounds: HalvingRound[]
  budget: number
  seed: number
  approval: string
  commit: string
  outDir: string
  source: EpisodeSource
  tasks: ManifestTask[]
  estimatedEpisodes: number
}

async function runWithArtifacts(opts: RunOptions): Promise<{ code: number; validation: ArtifactValidation }> {
  const meta: SnapshotMeta = {
    method: opts.method,
    base_id: opts.base.id,
    model: opts.base.model,
    seed: opts.seed,
    commit: opts.commit,
    approval: opts.approval,
    protocol_ref: PROTOCOL_REF,
    g0_manifest_hash: g0Hash,
    dev_manifest_hash: devHash,
    configs: opts.configs.map(configId),
    tasks: opts.tasks.map((t) => t.id),
    temperature: 0,
    max_steps: 10,
    seeds: opts.method === 'halving' ? [...new Set(opts.rounds.flatMap((r) => r.seeds))] : [0, 1, 2],
    margin: 0.05,
    weights: DEFAULT_WEIGHTS,
    rounds: opts.method === 'halving'
      ? opts.rounds.map((r) => ({ keep: r.keep, tasks: r.tasks.map((t) => t.id), seeds: r.seeds }))
      : null,
    estimated_episodes: opts.estimatedEpisodes,
  }
  const writer = createArtifactWriter(opts.outDir, meta)
  const runner: EpisodeRunner = async (config, taskId, seed) => {
    const { record, metrics, rerun, infraReason } = await opts.source(config, taskId, seed)
    const entry = { task_id: taskId, config_id: record.config_id, seed, reason: infraReason ?? record.failure_reason ?? 'unknown' }
    if (rerun) writer.recordInfraRerun(entry)
    // infra_error：补跑后仍失败 → 留痕 + 中止，绝不当作失败计入指标，也不静默剔除
    if (record.success === 'infra_error') {
      writer.recordInfra(entry)
      writer.appendEpisode(record)
      throw new InfraAbort(`infra_error persisted after one rerun: ${taskId} ${record.config_id} seed=${seed}`)
    }
    writer.appendEpisode(record)
    return metrics
  }

  let code = 0
  let best = ''
  try {
    const outcome = opts.method === 'halving'
      ? await successiveHalving({ baseId: opts.base.id, configs: opts.configs, rounds: opts.rounds, runEpisode: runner })
      : await equalBudgetRandom({
        baseId: opts.base.id, configs: opts.configs, runEpisode: runner,
        budget: opts.budget, tasks: opts.tasks.map((t) => ({ id: t.id })), seeds: [0, 1, 2], rng: mulberry32(opts.seed),
      })
    best = outcome.best_config_id
    writer.finalize(outcome, 'ok')
    console.log(`[${opts.method}] best=${best} episodes=${outcome.episodes} out=${opts.outDir}`)
  } catch (error) {
    const infra = error instanceof InfraAbort
    writer.finalize(null, infra ? 'aborted_infra_error' : 'aborted_error', error instanceof Error ? error.message : String(error))
    console.error(`[${opts.method}] aborted (${infra ? 'infra_error' : 'error'}): ${String(error)}`)
    console.error('按 G0 协议 §2：补跑仍失败的 episode 不计入指标、不得静默剔除；请上报组长后单独补跑。')
    code = infra ? 2 : 1
  }
  const validation = validateArtifacts(opts.outDir)
  if (!validation.ok) {
    console.error(`[${opts.method}] artifact validation FAILED:\n  - ${validation.problems.join('\n  - ')}`)
    return { code: code || 3, validation }
  }
  console.log(`[${opts.method}] artifacts OK: ${validation.episodes} episode lines, three-file set complete`)
  return { code, validation }
}

function help(): string {
  return `run-search — M3 配置搜索 CLI（successive halving / 等预算随机）

用法：
  node --import tsx/esm scripts/run-search.ts --dry-run [--base <id>] [--method halving|random]
  node --import tsx/esm scripts/run-search.ts --self-test [--out <dir>]
  node --env-file=.env --import tsx/esm scripts/run-search.ts --execute --base <id> --approval <id> [--method halving|random] [--seed 0]

选项：
  --dry-run    打印配置枚举、轮次计划、预算估算与门禁状态（无密钥，零 API）
  --self-test  零 API 端到端验证产物三件套（halving + random，产物写 analysis/out/）
  --execute    真实跑批（消耗预算；需冻结校验、30 任务、--approval、.env 密钥）
  --base       基座 id（默认 deepseek-v3；来自 configs/bases.yaml）
  --method     halving（默认）| random
  --seed       随机对照 rng 种子（默认 0）
  --approval   组长预算/超参冻结批准标识（--execute 必填，写入快照留痕）
  --out        产物目录（--self-test 默认 analysis/out/m3-selftest）`
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : undefined
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(help())
    return 0
  }
  const mode = args.includes('--self-test') ? 'self-test' : args.includes('--execute') ? 'execute' : 'dry-run'
  const baseId = argValue(args, '--base') ?? 'deepseek-v3'
  const method = argValue(args, '--method') ?? 'halving'
  const seed = Number(argValue(args, '--seed') ?? '0')
  const approval = argValue(args, '--approval') ?? ''
  const base = bases.find((b) => b.id === baseId)
  if (base === undefined) throw new Error(`unknown base ${baseId}（可选：${bases.map((b) => b.id).join(', ')}）`)
  if (method !== 'halving' && method !== 'random') throw new Error(`unknown method ${method}`)
  if (!Number.isFinite(seed)) throw new Error(`invalid --seed ${argValue(args, '--seed')}`)

  assertFrozenG0()
  const av = availability[baseId]
  if (av === undefined) throw new Error(`availability for ${baseId} missing（先跑 probe-bases.ts 实测填写）`)
  const configs = enumerateConfigs(av)
  const { rounds, warnings, estimatedEpisodes } = buildRounds(configs.length, allTasks.length)
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()

  console.log(`base=${baseId} model=${base.model} method=${method} mode=${mode}`)
  console.log(`availability: parallel_tool_calls=${av.parallel_tool_calls} reasoning_effort=${av.reasoning_effort} → 合法配置 ${configs.length} 个`)
  console.log(`任务集：g0 ${g0Manifest.tasks.length} + dev ${devManifest.tasks.length} = ${allTasks.length} 个（要求 ${REQUIRED_TASK_COUNT}）`)
  console.log(`g0 manifest sha256=${g0Hash}（与冻结协议一致）`)
  for (const w of warnings) console.log('  ⚠ ' + w)
  if (method === 'random') console.log('（下列轮次仅为 halving 的预算基准，random 取相同 episode 预算）')
  for (const [i, r] of rounds.entries()) console.log(`round ${i}: keep=${r.keep} tasks=${r.tasks.length} seeds=${JSON.stringify(r.seeds)}`)
  console.log(`预计 episode：${estimatedEpisodes}（实际随并列保留浮动；random 取同预算）`)

  if (mode === 'dry-run') {
    console.log('dry-run 完成（零 API）。--execute 需：30 任务 + --approval + .env 密钥 + 冻结校验通过。')
    return 0
  }

  // 门禁全部在「创建产物目录之前」完成，避免留下半截脏产物
  if (allTasks.length < REQUIRED_TASK_COUNT) {
    console.error(`[gate] 任务集不足：${allTasks.length} < ${REQUIRED_TASK_COUNT}。先补齐 dev 任务集，拒绝跑批。`)
    return 1
  }
  if (av.parallel_tool_calls === null || av.reasoning_effort === null) {
    console.error('[gate] availability 含未实测的 null，拒绝跑批。')
    return 1
  }

  if (mode === 'self-test') {
    const outRoot = argValue(args, '--out') ?? path.join(root, 'analysis/out/m3-selftest')
    rmSync(outRoot, { recursive: true, force: true })
    mkdirSync(outRoot, { recursive: true })
    const selfConfigs = configs.slice(0, 2)
    const selfTasks = allTasks.slice(0, 2)
    const selfRounds: HalvingRound[] = [{ keep: 1, tasks: selfTasks.map((t) => ({ id: t.id })), seeds: [0] }]
    const budget = selfConfigs.length * selfTasks.length
    let code = 0
    for (const m of ['halving', 'random'] as const) {
      const { code: c } = await runWithArtifacts({
        method: m, base, configs: selfConfigs, rounds: selfRounds, budget,
        seed, approval: 'self-test（零 API，无预算批准）', commit,
        outDir: path.join(outRoot, m), source: fakeEpisodeSource(),
        tasks: selfTasks, estimatedEpisodes: budget,
      })
      code = code || c
    }
    console.log(code === 0 ? '[self-test] PASS：halving + random 两条路径产物合规' : `[self-test] FAIL (code=${code})`)
    return code
  }

  // --execute：真实预算消耗，必须显式留痕批准
  if (approval.trim() === '') {
    console.error('[gate] --execute 需要 --approval <id>（组长预算/超参冻结批准留痕）。拒绝跑批。')
    return 1
  }
  let source: EpisodeSource
  try {
    source = realEpisodeSource(base)
  } catch (error) {
    console.error(`[gate] ${String(error)}`)
    return 1
  }
  const outDir = argValue(args, '--out') ?? path.join(root, 'experiments', `${new Date().toISOString().slice(0, 10)}-m3-search-${baseId}-${method}`)
  if (existsSync(outDir)) {
    console.error(`[gate] 产物目录已存在：${outDir}。请归档旧产物或用 --out 指定新目录，避免数据混合。`)
    return 1
  }
  console.log(`[execute] approval=${approval} commit=${commit} out=${outDir}`)
  const { code } = await runWithArtifacts({
    method, base, configs, rounds, budget: estimatedEpisodes,
    seed, approval, commit, outDir, source, tasks: allTasks.slice(0, REQUIRED_TASK_COUNT),
    estimatedEpisodes,
  })
  return code
}

main().then(
  (code) => { process.exitCode = code },
  (error) => { console.error('[run-search] fatal:', error); process.exitCode = 1 },
)
