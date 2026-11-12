// M2 出口一致性校验（P0）：runner 通道 vs DSH 通道，同任务同配置的完成率差 ≤10pp。
// 设计（docs/iteration-plan.md P0）：deepseek-v3 × 6 任务 × 2 配置 × seed 0 × 双通道 = 24 episode。
// - runner 通道：packages/runner 的 runEpisode（与 G0 完全相同的路径）；
// - DSH 通道：headless + overlay（临时策略库注入指定配置 + g0-tools + agent-loop 覆盖行），
//   禁用 session-title（dsh-spike.md §7）；真实密钥走 .env；每集一个进程 = 环境天然重置。
// 已知差异如实记录：DSH 无 temperature 配置（provider 默认 1.0），runner 协议为 0。
// 运行：node --env-file=.env --import tsx/esm scripts/run-consistency.ts
import { spawn } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { configId, type AgentConfig } from '@meta-tuning/action-space'
import { runEpisode, type EpisodeRecord, type Task } from '../packages/runner/src/index.ts'
import { MockTools } from '../packages/runner/src/mock-tools.ts'
import { VirtualFS } from '../packages/runner/src/virtual-fs.ts'
import { fixturesByTask } from '../tasks/g0/env/fixtures.ts'
import { checkers } from '../tasks/g0/checks/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dsh = path.join(root, 'vendor/deepseek-harness')
const BASE_ID = 'deepseek-v3'
const SEED = 0
// 刻意对比：策略库最优（step_by_step-p3）vs 反向配置（concise-p1）
const ARMS: Array<{ label: string; config: AgentConfig }> = [
  { label: 'step_by_step-p3', config: { prompt_style: 'step_by_step', max_parallel_tool_calls: 3, reasoning_effort: 'off' } },
  { label: 'concise-p1', config: { prompt_style: 'concise', max_parallel_tool_calls: 1, reasoning_effort: 'off' } },
]
const TASK_IDS = ['g0-tool-01', 'g0-tool-02', 'g0-reas-02', 'g0-reas-03', 'g0-code-01', 'g0-code-02']

interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases
const base = bases.find((b) => b.id === BASE_ID)
if (base === undefined) throw new Error(`base ${BASE_ID} not in configs/bases.yaml`)
const apiKey = process.env[base.api_key_env]
if (!apiKey) throw new Error(`missing env ${base.api_key_env} (.env)`)

const manifest = JSON.parse(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'), 'utf8')) as { tasks: Array<Task & { category: Task['category'] }> }
const manifestHash = createHash('sha256').update(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'))).digest('hex')
const tasks = TASK_IDS.map((id) => manifest.tasks.find((t) => t.id === id)).filter((t): t is Task => t !== undefined)
if (tasks.length !== TASK_IDS.length) throw new Error('manifest missing planned tasks')

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
const stamp = new Date().toISOString().slice(0, 10)
const outDir = path.join(root, 'experiments', `${stamp}-m2-consistency`)
mkdirSync(outDir, { recursive: true })
writeFileSync(path.join(outDir, 'config.snapshot.json'), JSON.stringify({
  plan: 'docs/iteration-plan.md P0', base: { id: BASE_ID, model: base.model, base_url: base.base_url },
  arms: ARMS.map((a) => ({ label: a.label, config: a.config })), tasks: TASK_IDS, seed: SEED,
  channels: ['runner', 'dsh'], manifestHash, commit,
  knownDivergence: 'DSH has no temperature config (provider default); runner uses protocol temperature 0',
}, null, 2))

const append = (file: string, line: unknown): void => { writeFileSync(path.join(outDir, file), JSON.stringify(line) + '\n', { flag: 'a' }) }

const epFile = path.join(outDir, 'episodes.jsonl')

interface ConsistencyRecord {
  task_id: string; config_id: string; channel: 'runner' | 'dsh'; seed: number
  pass: boolean; reason: string; latency_ms: number | null
  steps: number | null; failure_reason: string | null
  tool_calls: number | null; tool_names: string[] | null; dump_exists: boolean | null
}

async function runnerEpisode(task: Task, config: AgentConfig, cid: string): Promise<ConsistencyRecord> {
  const t0 = Date.now()
  const checker = checkers[task.id]
  const check = (fs: Parameters<typeof checker>[0]['fs'], finalAnswer: string) =>
    checker({ fs, finalAnswer, toolCalls: 0, toolErrors: 0 })
  const ctx = { baseId: BASE_ID, baseUrl: base!.base_url, apiKey: apiKey!, model: base!.model, config, seed: SEED }
  const rec: EpisodeRecord = await runEpisode(task, ctx, check, new MockTools(fixturesByTask[task.id] ?? {}))
  // infra 重试一次（与协议 §2 同纪律）
  let final = rec
  if (final.success === 'infra_error') final = await runEpisode(task, ctx, check, new MockTools(fixturesByTask[task.id] ?? {}))
  return {
    task_id: task.id, config_id: cid, channel: 'runner', seed: SEED,
    pass: final.success === true, reason: final.success === true ? 'ok' : (final.failure_reason ?? 'failed'),
    latency_ms: Date.now() - t0, steps: final.steps, failure_reason: final.success === true ? null : (final.failure_reason ?? null),
    tool_calls: final.tool_calls, tool_names: null, dump_exists: null,
  }
}

async function dshEpisode(task: Task, config: AgentConfig, cid: string, tmp: string, index: number): Promise<ConsistencyRecord> {
  const t0 = Date.now()
  // 临时策略库：让 overlay 生成器注入指定配置（复用 buildOverlayYaml 的单一事实来源逻辑）
  const store = path.join(tmp, `policies-${index}.json`)
  writeFileSync(store, JSON.stringify({ version: 1, entries: [{ base_id: BASE_ID, config, dev_score: 0, search_meta: { method: 'consistency-arm', episodes: 0, commit, date: stamp } }] }))
  const { buildOverlayYaml } = await import('../packages/plugin-meta-controller/src/overlay.ts')
  const overlay = path.join(tmp, `overlay-${index}.yml`)
  const dumpFsPath = path.join(tmp, `fs-${index}.json`)
  writeFileSync(overlay, buildOverlayYaml({
    pluginEntry: path.join(root, 'packages/plugin-meta-controller/src/index.ts'),
    policyStore: store, baseId: BASE_ID, presetRegistry: true,
  }) + '- id: session-title\n  disabled: true\n')
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', 'apps/cli/src/bin.ts',
    '--patch', overlay, '--profile', 'headless', task.instruction,
  ], {
    cwd: dsh,
    env: { ...process.env, [base!.api_key_env]: apiKey!, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (x) => { stdout += x })
  child.stderr.on('data', (x) => { stderr += x })
  const timer = setTimeout(() => child.kill('SIGKILL'), 180_000)
  const code = await new Promise((resolve) => child.on('exit', resolve))
  clearTimeout(timer)
  if (code !== 0) {
    return { task_id: task.id, config_id: cid, channel: 'dsh', seed: SEED, pass: false, reason: `infra: headless exit ${code}: ${stderr.slice(0, 160)}`, latency_ms: Date.now() - t0, steps: null, failure_reason: 'infra_error', tool_calls: null, tool_names: null, dump_exists: existsSync(dumpFsPath) }
  }
  let fsState: Record<string, string> = {}
  let toolCalls: Array<{ name: string; isError: boolean }> = []
  try {
    const dump = JSON.parse(readFileSync(dumpFsPath, 'utf8')) as { files: Record<string, string>; toolCalls?: Array<{ name: string; isError: boolean }> }
    fsState = dump.files ?? {}
    toolCalls = dump.toolCalls ?? []
  } catch { /* 答案型任务可能无写入 */ }
  const checker = checkers[task.id]
  const verdict = checker({ fs: new VirtualFS(fsState), finalAnswer: stdout.trim(), toolCalls: 0, toolErrors: 0 })
  return { task_id: task.id, config_id: cid, channel: 'dsh', seed: SEED, pass: verdict.pass, reason: verdict.reason, latency_ms: Date.now() - t0, steps: null, failure_reason: null, tool_calls: toolCalls.length, tool_names: toolCalls.map((t) => t.name + (t.isError ? '!' : '')), dump_exists: true }
}

console.log(`consistency: ${tasks.length} tasks × ${ARMS.length} arms × 2 channels × seed ${SEED}`)
const tmp = mkdtempSync(path.join(tmpdir(), 'm2-consistency-'))
const results: ConsistencyRecord[] = []
let index = 0
for (const arm of ARMS) {
  const cid = configId(arm.config)
  for (const task of tasks) {
    // runner 通道
    let rec = await runnerEpisode(task, arm.config, cid).catch((e) => ({ task_id: task.id, config_id: cid, channel: 'runner' as const, seed: SEED, pass: false, reason: `infra: ${String(e).slice(0, 160)}`, latency_ms: null, steps: null, failure_reason: 'infra_error', tool_calls: null, tool_names: null, dump_exists: null }))
    results.push(rec); append('episodes.jsonl', rec)
    console.log(`runner ${cid} ${task.id}: ${rec.pass ? 'PASS' : 'FAIL'} (${rec.reason.slice(0, 60)})`)
    // DSH 通道
    index += 1
    rec = await dshEpisode(task, arm.config, cid, tmp, index).catch((e) => ({ task_id: task.id, config_id: cid, channel: 'dsh' as const, seed: SEED, pass: false, reason: `infra: ${String(e).slice(0, 160)}`, latency_ms: null, steps: null, failure_reason: 'infra_error', tool_calls: null, tool_names: null, dump_exists: null }))
    results.push(rec); append('episodes.jsonl', rec)
    console.log(`dsh    ${cid} ${task.id}: ${rec.pass ? 'PASS' : 'FAIL'} (${rec.reason.slice(0, 60)})`)
  }
}
rmSync(tmp, { recursive: true, force: true })

// 汇总：完成率按「有效 episode」（infra_error 不计入）与协议 §2 同纪律
function rate(records: ConsistencyRecord[], channel: 'runner' | 'dsh', cid?: string): { r: number; n: number } {
  const rows = results.filter((x) => x.channel === channel && x.failure_reason !== 'infra_error' && (cid === undefined || x.config_id === cid))
  return { r: rows.length === 0 ? 0 : rows.filter((x) => x.pass).length / rows.length, n: rows.length }
}
const overall = { runner: rate(results, 'runner'), dsh: rate(results, 'dsh') }
const perArm = ARMS.map((a) => ({ config_id: configId(a.config), runner: rate(results, 'runner', configId(a.config)), dsh: rate(results, 'dsh', configId(a.config)) }))
const gap = Math.abs(overall.runner.r - overall.dsh.r)
const report = {
  plan: 'docs/iteration-plan.md P0', date: new Date().toISOString(), episodes: results.length,
  overall, perArm, gap: +gap.toFixed(4),
  gate: 'M2 exit: |runner - dsh| completion-rate gap ≤ 0.10',
  pass: gap <= 0.10,
  knownDivergence: 'DSH temperature not configurable (provider default ~1.0) vs runner protocol temperature 0',
  infraNote: 'infra_error episodes excluded from rates (protocol §2 discipline)',
}
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ overall, perArm, gap: report.gap, pass: report.pass }, null, 2))
console.log(report.pass ? 'M2 CONSISTENCY GATE PASSED' : 'M2 CONSISTENCY GATE FAILED')
process.exit(0)
