// 阶段 A 诊断跑（DEV-01 重测第一段，预算 ≈¥13）：
// 仅跑受两类测量假象影响的 3 个任务（g0-reas-02 / g0-code-01 / g0-code-02），
// 3 基座 × 9 配置 × 2 seed = 162 episode，协议 v1.1 判定语义（语义等价匹配 + CommonJS 垫片）。
// 目的：验证修复在真实模型上生效——
//   H-A1: g0-reas-02 不再出现「答案含 yes 但严格匹配失败」（answerYesNo 已吸收）；
//   H-A2: g0-code-01/02 的 `module is not defined` 归零（垫片已吸收）；
//   H-A3: 各任务完成率与 v1.0 对照的变化集中在假象吸收，其他失败模式不变。
// 产物：experiments/<date>-m1-g0-diag-dev01/{config.snapshot.json, episodes.jsonl, report.json}
// 运行：node --env-file=.env --import tsx/esm scripts/run-g0-diag.ts
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { configId, enumerateConfigs, type AgentConfig, type Availability } from '@meta-tuning/action-space'
import { runEpisode, type EpisodeRecord, type Task } from '../packages/runner/src/index.ts'
import { MockTools } from '../packages/runner/src/mock-tools.ts'
import { fixturesByTask } from '../tasks/g0/env/fixtures.ts'
import { checkers } from '../tasks/g0/checks/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TASK_IDS = ['g0-reas-02', 'g0-code-01', 'g0-code-02']

interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases
const availability = (loadYaml(readFileSync(path.join(root, 'configs/availability.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: Record<string, Availability> }).bases
const manifest = JSON.parse(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'), 'utf8')) as { tasks: Array<Task & { category: Task['category'] }> }
const manifestHash = createHash('sha256').update(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'))).digest('hex')
const tasks = TASK_IDS.map((id) => manifest.tasks.find((t) => t.id === id)).filter((t): t is Task => t !== undefined)
if (tasks.length !== TASK_IDS.length) throw new Error('manifest missing diagnostic tasks')

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
const stamp = new Date().toISOString().slice(0, 10)
const outDir = path.join(root, 'experiments', `${stamp}-m1-g0-diag-dev01`)
mkdirSync(outDir, { recursive: true })
const g0Av: Availability = { parallel_tool_calls: true, reasoning_effort: false }
const allConfigs = enumerateConfigs(g0Av)
writeFileSync(path.join(outDir, 'config.snapshot.json'), JSON.stringify({
  protocol: 'g0-protocol.md v1.1 (deviation DEV-01, see docs/m3-deviation-01-judger-robustness.md)',
  stage: 'A-diagnostic', manifestHash, commit,
  bases: bases.map((b) => ({ id: b.id, model: b.model, base_url: b.base_url })),
  configs: allConfigs.map(configId), tasks: TASK_IDS, seeds: [0, 1],
  temperature: 0, maxSteps: 10, concurrency: 2,
}, null, 2))

interface Job { base: BaseConfig; config: AgentConfig; task: Task; seed: number }
const jobs: Job[] = []
for (const base of bases)
  for (const config of allConfigs)
    for (const task of tasks)
      for (const seed of [0, 1])
        jobs.push({ base, config, task, seed })
const total = jobs.length

console.log(`diag: ${total} episodes (${bases.length} bases × ${allConfigs.length} configs × ${tasks.length} tasks × 2 seeds)`)
const records: EpisodeRecord[] = []
const infraFailures: Array<{ task: string; base: string; config: string; seed: number; reason: string }> = []
let cursor = 0
let done = 0

async function worker(): Promise<void> {
  while (cursor < total) {
    const { base, config, task, seed } = jobs[cursor++]
    const apiKey = process.env[base.api_key_env]
    if (!apiKey) throw new Error(`missing env ${base.api_key_env}`)
    const ctx = { baseId: base.id, baseUrl: base.base_url, apiKey, model: base.model, config, seed }
    const checker = checkers[task.id]
    const check = (fs: Parameters<typeof checker>[0]['fs'], finalAnswer: string) =>
      checker({ fs, finalAnswer, toolCalls: 0, toolErrors: 0 })
    let record = await runEpisode(task, ctx, check, new MockTools(fixturesByTask[task.id] ?? {}))
    if (record.success === 'infra_error') {
      console.warn(`infra_error, rerunning once: ${task.id} ${base.id} ${configId(config)} seed=${seed}`)
      record = await runEpisode(task, ctx, check, new MockTools(fixturesByTask[task.id] ?? {}))
      if (record.success === 'infra_error') infraFailures.push({ task: task.id, base: base.id, config: configId(config), seed, reason: record.failure_reason ?? 'unknown' })
    }
    records.push(record)
    appendFileSync(path.join(outDir, 'episodes.jsonl'), JSON.stringify(record) + '\n')
    done += 1
    if (done % 20 === 0 || done === total) console.log(`progress ${done}/${total}`)
  }
}

await Promise.all([worker(), worker()])

// H-A 验证指标
function rate(pred: (r: EpisodeRecord) => boolean): { n: number; count: number } {
  const rows = records.filter(pred)
  return { n: rows.length, count: rows.length }
}
const strictYesFailures = rate((r) => r.task_id === 'g0-reas-02' && (r.failure_reason ?? '').startsWith('expected yes, got'))
const moduleErrors = rate((r) => (r.failure_reason ?? '').includes('module is not defined'))
const vmErrors = rate((r) => (r.failure_reason ?? '').startsWith('vm error'))
const emptyAnswers = rate((r) => (r.failure_reason ?? '').includes('got ""'))
const passRate = (taskId: string) => {
  const rows = records.filter((r) => r.task_id === taskId && r.success !== 'infra_error')
  return rows.length === 0 ? 0 : rows.filter((r) => r.success === true).length / rows.length
}
const report = {
  stage: 'A-diagnostic', date: new Date().toISOString(), episodes: records.length,
  infraFailures,
  hypotheses: {
    'H-A1 strict-yes-match failures (v1.0: 18)': strictYesFailures,
    'H-A2 module-is-not-defined (v1.0: 31 across all 12 tasks; here only code-01/02 relevant)': moduleErrors,
    'H-A2b any vm error': vmErrors,
    'empty answers (real failures, expect to persist)': emptyAnswers,
  },
  passRate: Object.fromEntries(TASK_IDS.map((t) => [t, +passRate(t).toFixed(4)])),
  tokens: records.reduce((s, x) => s + x.prompt_tokens + x.completion_tokens, 0),
}
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
console.log('STAGE A DONE — 检查 hypotheses 后再决定是否进入阶段 B')
