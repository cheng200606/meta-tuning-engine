// M3 搜索 CLI 骨架（docs/iteration-plan.md P1 第 5 项）：
// - 读取 configs/{bases,availability}.yaml，按可用性矩阵枚举合法配置（27 上限）；
// - 默认 --dry-run：打印 halving 轮次计划与 episode 预算估算，零 API、无密钥可跑；
// - --method random：等预算随机对照的计划；
// - --execute：真实跑批（M3 执行时接 .env 密钥 + 组长预算确认；本骨架已接好 runEpisode 通道）。
// 任务集：g0 12 个（冻结）+ tasks/dev/manifest.json 现有任务；不足 30 个时如实报告缺口。
// 运行：node --import tsx/esm scripts/run-search.ts --help | --dry-run [--base deepseek-v3] [--method halving|random]
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { configId, enumerateConfigs, type AgentConfig, type Availability } from '@meta-tuning/action-space'
import { equalBudgetRandom, successiveHalving, type EpisodeRunner, type HalvingRound } from '../packages/search/src/halving.ts'
import { runEpisode } from '../packages/runner/src/index.ts'
import { MockTools } from '../packages/runner/src/mock-tools.ts'
import { fixturesByTask as g0Fixtures } from '../tasks/g0/env/fixtures.ts'
import { checkers } from '../tasks/g0/checks/index.ts'
import { checkers as devCheckers } from '../tasks/dev/checks/index.ts'
import { fixturesByTask as devFixtures } from '../tasks/dev/env/fixtures.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases
const availability = (loadYaml(readFileSync(path.join(root, 'configs/availability.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: Record<string, Availability> }).bases

const g0Manifest = JSON.parse(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'), 'utf8')) as { tasks: Array<{ id: string; instruction: string; category: string }> }
const devManifestPath = path.join(root, 'tasks/dev/manifest.json')
const devManifest = JSON.parse(readFileSync(devManifestPath, 'utf8')) as { tasks: Array<{ id: string; instruction: string; category: string }> }
const manifestHash = createHash('sha256').update(readFileSync(devManifestPath)).digest('hex')

// 任务集：g0 冻结 12 + dev 现有（M3 前补齐到 30；方案 §6.1）
const allTasks = [...g0Manifest.tasks, ...devManifest.tasks]

const DEFAULT_ROUND_SPECS = [
  { keep: 9, tasks: 6, seeds: [0] },
  { keep: 3, tasks: 12, seeds: [0, 1] },
  { keep: 1, tasks: 30, seeds: [0, 1, 2] },
]

function buildRounds(configCount: number, taskCount: number): { rounds: HalvingRound[]; warnings: string[]; estimatedEpisodes: number } {
  const warnings: string[] = []
  if (taskCount < DEFAULT_ROUND_SPECS[DEFAULT_ROUND_SPECS.length - 1].tasks) {
    warnings.push(`任务集仅 ${taskCount} 个（目标 30）：轮次按现有任务数执行，dev 集补齐后重跑`)
  }
  const rounds: HalvingRound[] = []
  let estimated = 0
  let survivors = configCount
  for (const [i, r] of DEFAULT_ROUND_SPECS.entries()) {
    const nTasks = Math.min(r.tasks, taskCount)
    const keep = Math.min(r.keep, survivors)
    rounds.push({ keep, tasks: allTasks.slice(0, nTasks).map((t) => ({ id: t.id })), seeds: r.seeds })
    estimated += survivors * nTasks * r.seeds.length
    survivors = keep
    void i
  }
  return { rounds, warnings, estimatedEpisodes: estimated }
}

function episodeRunnerFor(base: BaseConfig): EpisodeRunner {
  const apiKey = process.env[base.api_key_env]
  if (!apiKey) throw new Error(`missing env ${base.api_key_env}（--execute 需要 .env 密钥）`)
  return async (config, taskId, seed) => {
    const task = allTasks.find((t) => t.id === taskId)
    if (task === undefined) throw new Error(`unknown task ${taskId}`)
    const checker = (devCheckers[taskId] ?? checkers[taskId])
    const fixtures = { ...g0Fixtures, ...devFixtures }
    const ctx = { baseId: base.id, baseUrl: base.base_url, apiKey, model: base.model, config, seed }
    const record = await runEpisode(task as never, ctx, (fs, finalAnswer) => checker({ fs, finalAnswer, toolCalls: 0, toolErrors: 0 }), new MockTools(fixtures[taskId] ?? {}))
    return { success: record.success === true, tool_accuracy: record.tool_calls === 0 ? 1 : 1 - record.tool_errors / record.tool_calls, steps: record.steps, cost: record.prompt_tokens + record.completion_tokens }
  }
}

function main(): number {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`run-search — M3 配置搜索 CLI（successive halving / 等预算随机）

用法：
  node --import tsx/esm scripts/run-search.ts --dry-run [--base <id>] [--method halving|random]
  node --env-file=.env --import tsx/esm scripts/run-search.ts --execute --base <id> [--method halving] [--seed 0]

选项：
  --dry-run   打印配置枚举、轮次计划与 episode 预算估算（无密钥，零 API）
  --execute   真实跑批（需 .env 密钥与组长预算确认，M3 执行）
  --base      基座 id（默认 deepseek-v3；来自 configs/bases.yaml）
  --method    halving（默认）| random
  --seed      随机对照的 rng 种子（默认 0）`)
    return 0
  }
  const baseId = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'deepseek-v3'
  const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'halving'
  const seed = args.includes('--seed') ? Number(args[args.indexOf('--seed') + 1]) : 0
  const base = bases.find((b) => b.id === baseId)
  if (base === undefined) throw new Error(`unknown base ${baseId}（可选：${bases.map((b) => b.id).join(', ')}）`)
  if (method !== 'halving' && method !== 'random') throw new Error(`unknown method ${method}`)

  const av = availability[baseId]
  if (av === undefined) throw new Error(`availability for ${baseId} missing（先跑 probe-bases.ts 实测填写）`)
  const configs = enumerateConfigs(av)
  const { rounds, warnings, estimatedEpisodes } = buildRounds(configs.length, allTasks.length)

  console.log(`base=${baseId} model=${base.model}`)
  console.log(`availability: parallel_tool_calls=${av.parallel_tool_calls} reasoning_effort=${av.reasoning_effort} → 合法配置 ${configs.length} 个`)
  for (const c of configs) console.log('  -', configId(c))
  console.log(`任务集：g0 ${g0Manifest.tasks.length} + dev ${devManifest.tasks.length} = ${allTasks.length} 个`)
  for (const w of warnings) console.log('  ⚠ ' + w)
  if (method === 'halving') {
    for (const [i, r] of rounds.entries()) console.log(`round ${i}: keep=${r.keep} tasks=${r.tasks.length} seeds=${JSON.stringify(r.seeds)}`)
    console.log(`预计 episode：${estimatedEpisodes}（halving，实际随并列保留浮动）`)
  } else {
    console.log(`预计 episode：${estimatedEpisodes}（random 等预算对照，预算取 halving 估算）`)
  }
  if (!args.includes('--execute')) {
    console.log('（dry-run 完成；--execute 真实跑批需 .env 密钥与预算确认）')
    return 0
  }
  // 真实跑批：实验产物按 experiments/README 规范落盘
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
  const stamp = new Date().toISOString().slice(0, 10)
  const outDir = path.join(root, 'experiments', `${stamp}-m3-search-${baseId}-${method}`)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(path.join(outDir, 'config.snapshot.json'), JSON.stringify({
    plan: 'docs/iteration-plan.md P1', method, base: { id: base.id, model: base.model }, seed,
    configs: configs.map(configId), tasks: allTasks.map((t) => t.id), rounds: method === 'halving' ? rounds : undefined,
    devManifestHash: manifestHash, commit, estimatedEpisodes,
  }, null, 2))
  let runner: EpisodeRunner
  try {
    runner = episodeRunnerFor(base)
  } catch (error) {
    console.error(`[run-search] ${String(error)}`)
    return 1
  }
  const seedFn = (): number => {
    let a = seed >>> 0
    return (): number => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  }
  if (method === 'halving') {
    return successiveHalving({ baseId: base.id, configs, rounds, runEpisode: runner })
      .then((out) => { writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify({ best: out.best_config_id, episodes: out.episodes, survivors: out.survivors }, null, 2)); return 0 })
      .catch((e) => { console.error(String(e)); return 1 })
  }
  return equalBudgetRandom({
    baseId: base.id, configs, runEpisode: runner,
    budget: estimatedEpisodes, tasks: allTasks.map((t) => ({ id: t.id })), seeds: [0, 1, 2], rng: seedFn(),
  })
    .then((out) => { writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(out, null, 2)); console.log(JSON.stringify({ best: out.best_config_id, episodes: out.episodes }, null, 2)); return 0 })
    .catch((e) => { console.error(String(e)); return 1 })
}

process.exit(main())
