// G0 门禁实验流水线（协议：docs/g0-protocol.md v1.0）
// 运行：node --env-file=.env --import tsx/esm scripts/run-g0.ts --smoke | --full | --plumbing
// --smoke：deepseek-v3 × 2 配置 × 前 5 任务 × 2 seed = 20 episode（协议 §4.1）
// --full：3 基座 × 9 配置 × 12 任务 × 2 seed = 648 episode；要求 availability 全部实测填写
// --plumbing：本地假端点（scripts/plumbing-mock.ts）验证实验机器，非 G0 实验，不受冻结门禁约束
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { enumerateConfigs, configId, type AgentConfig, type Availability } from '@meta-tuning/action-space'
import { runEpisode, type EpisodeRecord, type Task } from '../packages/runner/src/index.ts'
import { MockTools } from '../packages/runner/src/mock-tools.ts'
import { computeG0Report } from '../packages/search/src/g0-report.ts'
import { fixturesByTask } from '../tasks/g0/env/fixtures.ts'
import { checkers } from '../tasks/g0/checks/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv.includes('--full') ? 'full' : process.argv.includes('--smoke') ? 'smoke' : process.argv.includes('--plumbing') ? 'plumbing' : null
if (mode === null) {
  console.error('usage: run-g0.ts --smoke | --full | --plumbing')
  process.exit(1)
}

interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases
const availability = (loadYaml(readFileSync(path.join(root, 'configs/availability.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: Record<string, Availability> }).bases
const manifest = JSON.parse(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'), 'utf8')) as { tasks: Array<Task & { category: Task['category'] }> }
const manifestHash = createHash('sha256').update(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'))).digest('hex')

const protocol = readFileSync(path.join(root, 'docs/g0-protocol.md'), 'utf8')
if (!protocol.includes(manifestHash)) {
  console.error('manifest sha256 does not match frozen protocol — refreeze required')
  process.exit(1)
}
if (!protocol.includes('已冻结') && mode === 'full') {
  console.error('protocol not signed/frozen (docs/g0-protocol.md §9) — full run refused')
  process.exit(1)
}

const g0Availability: Availability = { parallel_tool_calls: true, reasoning_effort: false }
const allConfigs = enumerateConfigs(g0Availability)
const plumbingBase: BaseConfig = { id: 'plumbing-fake', model: 'fake', base_url: 'http://127.0.0.1:8123', api_key_env: 'PLUMBING_KEY' }
const runBases = mode === 'plumbing' ? [plumbingBase] : mode === 'smoke' ? bases.filter((b) => b.id === 'deepseek-v3') : bases
const runConfigs = mode === 'plumbing' ? allConfigs.slice(0, 2) : mode === 'smoke' ? allConfigs.filter((c) => ['concise-p1-roff', 'step_by_step-p3-roff'].includes(configId(c))) : allConfigs
const runTasks = mode === 'plumbing' ? manifest.tasks.slice(0, 3) : mode === 'smoke' ? manifest.tasks.slice(0, 5) : manifest.tasks
const seeds = mode === 'plumbing' ? [0] : [0, 1]

if (mode === 'full') {
  for (const base of runBases) {
    const av = availability[base.id]
    if (av === undefined || av.parallel_tool_calls === null || av.reasoning_effort === null) {
      console.error(`availability for ${base.id} not measured (configs/availability.yaml has null) — M0 spike item 5 required`)
      process.exit(1)
    }
  }
}

const stamp = new Date().toISOString().slice(0, 10)
const outDir = path.join(root, 'experiments', `${stamp}-m1-g0-${mode}`)
mkdirSync(outDir, { recursive: true })
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
writeFileSync(path.join(outDir, 'config.snapshot.json'), JSON.stringify({
  protocol: 'g0-protocol.md v1.0', mode, manifestHash, commit,
  bases: runBases.map((b) => ({ id: b.id, model: b.model, base_url: b.base_url })),
  configs: runConfigs.map(configId), tasks: runTasks.map((t) => t.id), seeds,
  temperature: 0, maxSteps: 10, concurrency: 2,
}, null, 2))

interface Job { base: BaseConfig; config: AgentConfig; task: Task; seed: number }
const jobs: Job[] = []
for (const base of runBases)
  for (const config of runConfigs)
    for (const task of runTasks)
      for (const seed of seeds)
        jobs.push({ base, config, task, seed })

console.log(`mode=${mode} episodes=${jobs.length} out=${outDir}`)
const records: EpisodeRecord[] = []
const infraFailures: Array<{ job: Job; reason: string }> = []
let cursor = 0
let done = 0

async function worker(): Promise<void> {
  while (cursor < jobs.length) {
    const job = jobs[cursor++]
    const apiKey = process.env[job.base.api_key_env] ?? (mode === 'plumbing' ? 'plumbing' : undefined)
    if (!apiKey) throw new Error(`missing env ${job.base.api_key_env}`)
    const ctx = {
      baseId: job.base.id, baseUrl: job.base.base_url, apiKey, model: job.base.model,
      config: job.config, seed: job.seed,
    }
    const checker = checkers[job.task.id]
    const check = (fs: Parameters<typeof checker>[0]['fs'], finalAnswer: string) =>
      checker({ fs, finalAnswer, toolCalls: 0, toolErrors: 0 })
    let record = await runEpisode(job.task, ctx, check, new MockTools(fixturesByTask[job.task.id] ?? {}))
    if (record.success === 'infra_error') {
      console.warn(`infra_error, rerunning once: ${job.task.id} ${job.base.id} ${configId(job.config)} seed=${job.seed}`)
      record = await runEpisode(job.task, ctx, check, new MockTools(fixturesByTask[job.task.id] ?? {}))
      if (record.success === 'infra_error') infraFailures.push({ job, reason: record.failure_reason ?? 'unknown' })
    }
    records.push(record)
    appendFileSync(path.join(outDir, 'episodes.jsonl'), JSON.stringify(record) + '\n')
    done += 1
    if (done % 20 === 0 || done === jobs.length) console.log(`progress ${done}/${jobs.length}`)
  }
}

await Promise.all([worker(), worker()])

// 判据计算（协议 §5）：共享模块，与修复跑同一实现
const report = computeG0Report({
  records,
  baseIds: runBases.map((b) => b.id),
  cids: runConfigs.map(configId),
  mode,
  infraFailures: infraFailures.map((f) => ({ task: f.job.task.id, base: f.job.base.id, config: configId(f.job.config), seed: f.job.seed, reason: f.reason })),
})
writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ C1: report.C1, C2: report.C2, delta: report.delta, decision: report.decision, tokens: report.tokens }, null, 2))