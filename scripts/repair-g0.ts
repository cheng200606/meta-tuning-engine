// G0 修复跑（组长 2026-11-11 批准选项 A）：只补无有效记录的缺失格。
// 并发 1 + 每请求前间隔 2s，规避硅基流动免费档限流。原始 infra 行保留留痕。
// 运行：node --env-file=.env --import tsx/esm scripts/repair-g0.ts
import { appendFileSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { enumerateConfigs, configId, type AgentConfig, type Availability } from '@meta-tuning/action-space'
import { runEpisode, type EpisodeRecord, type Task } from '../packages/runner/src/index.ts'
import { MockTools } from '../packages/runner/src/mock-tools.ts'
import { computeG0Report, type InfraFailure } from '../packages/search/src/g0-report.ts'
import { fixturesByTask } from '../tasks/g0/env/fixtures.ts'
import { checkers } from '../tasks/g0/checks/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runDir = path.join(root, 'experiments/2026-11-10-m1-g0-full')
const episodesPath = path.join(runDir, 'episodes.jsonl')

interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases
const manifest = JSON.parse(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'), 'utf8')) as { tasks: Task[] }
const configs = enumerateConfigs({ parallel_tool_calls: true, reasoning_effort: false } as Availability)
const seeds = [0, 1]

const records: EpisodeRecord[] = readFileSync(episodesPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as EpisodeRecord)
const validKeys = new Set(records.filter((r) => r.success !== 'infra_error').map((r) => `${r.base}|${r.config_id}|${r.task_id}|${r.seed}`))

interface Job { base: BaseConfig; config: AgentConfig; task: Task; seed: number }
const missing: Job[] = []
for (const base of bases)
  for (const config of configs)
    for (const task of manifest.tasks)
      for (const seed of seeds)
        if (!validKeys.has(`${base.id}|${configId(config)}|${task.id}|${seed}`))
          missing.push({ base, config, task, seed })

console.log(`missing cells: ${missing.length}`)
if (missing.length === 0) {
  console.log('nothing to repair')
  process.exit(0)
}
copyFileSync(path.join(runDir, 'report.json'), path.join(runDir, 'report.pre-repair.json'))

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
let done = 0
let stillInfra = 0
for (const job of missing) {
  const apiKey = process.env[job.base.api_key_env]
  if (!apiKey) throw new Error(`missing env ${job.base.api_key_env}`)
  const ctx = { baseId: job.base.id, baseUrl: job.base.base_url, apiKey, model: job.base.model, config: job.config, seed: job.seed }
  const checker = checkers[job.task.id]
  const check = (fs: Parameters<typeof checker>[0]['fs'], finalAnswer: string) => checker({ fs, finalAnswer, toolCalls: 0, toolErrors: 0 })
  await delay(2000)
  let record = await runEpisode(job.task, ctx, check, new MockTools(fixturesByTask[job.task.id] ?? {}))
  if (record.success === 'infra_error') {
    await delay(5000)
    record = await runEpisode(job.task, ctx, check, new MockTools(fixturesByTask[job.task.id] ?? {}))
    if (record.success === 'infra_error') stillInfra += 1
  }
  records.push(record)
  appendFileSync(episodesPath, JSON.stringify(record) + '\n')
  done += 1
  if (done % 10 === 0 || done === missing.length) console.log(`repair progress ${done}/${missing.length} (still infra: ${stillInfra})`)
}

// 重算判据：仍缺失的格按 infra 留痕列出
const validAfter = new Set(records.filter((r) => r.success !== 'infra_error').map((r) => `${r.base}|${r.config_id}|${r.task_id}|${r.seed}`))
const infraFailures: InfraFailure[] = []
for (const base of bases)
  for (const config of configs)
    for (const task of manifest.tasks)
      for (const seed of seeds) {
        const key = `${base.id}|${configId(config)}|${task.id}|${seed}`
        if (validAfter.has(key)) continue
        const lastInfra = [...records].reverse().find((r) => r.success === 'infra_error' && `${r.base}|${r.config_id}|${r.task_id}|${r.seed}` === key)
        infraFailures.push({ task: task.id, base: base.id, config: configId(config), seed, reason: lastInfra?.failure_reason ?? 'no valid record' })
      }

const report = computeG0Report({ records, baseIds: bases.map((b) => b.id), cids: configs.map(configId), mode: 'full-repair', infraFailures })
writeFileSync(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ repaired: done, stillInfra, C1: report.C1, C2: report.C2, delta: report.delta, decision: report.decision }, null, 2))