// G0 infra 修复跑（对应 docs/g0-decision.md 待组长决策的选项 A 的执行件）
// 范围：原全量 run 中 success==='infra_error' 的 (base, config_id, task_id, seed) 格（qwen 56 + glm 6 = 62）
// 方式：并发 1 + 每集前置 2s 间隔（避免复现 429 限流）；每格最多跑 1 次（runner 内部已含 3 次退避重试）
// 产物：experiments/2026-11-10-m1-g0-full/repair-episodes.jsonl + repair-report.json
// 纪律：绝不改动原 episodes.jsonl / report.json / config.snapshot.json；判据按「原口径」与「合并修复口径」各算一遍
// 运行：node --env-file=.env --import tsx/esm scripts/repair-g0-infra.ts
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load as loadYaml } from 'js-yaml'
import { enumerateConfigs, configId, type AgentConfig, type Availability } from '@meta-tuning/action-space'
import { runEpisode, type EpisodeRecord, type Task } from '../packages/runner/src/index.ts'
import { MockTools } from '../packages/runner/src/mock-tools.ts'
import { fixturesByTask } from '../tasks/g0/env/fixtures.ts'
import { checkers } from '../tasks/g0/checks/index.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expDir = path.join(root, 'experiments/2026-11-10-m1-g0-full')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface BaseConfig { id: string; model: string; base_url: string; api_key_env: string }
const bases = (loadYaml(readFileSync(path.join(root, 'configs/bases.yaml'), 'utf8'), { schema: JSON_SCHEMA }) as { bases: BaseConfig[] }).bases
const baseById = new Map(bases.map((b) => [b.id, b]))
const g0Availability: Availability = { parallel_tool_calls: true, reasoning_effort: false }
const configById = new Map<string, AgentConfig>(enumerateConfigs(g0Availability).map((c) => [configId(c), c]))
const manifest = JSON.parse(readFileSync(path.join(root, 'tasks/g0/tasks.manifest.json'), 'utf8')) as { tasks: Array<Task & { category: Task['category'] }> }
const taskById = new Map(manifest.tasks.map((t) => [t.id, t]))
const commit = readFileSync(path.join(expDir, 'config.snapshot.json'), 'utf8')
const snapshot = JSON.parse(commit) as { commit: string; manifestHash: string }

// 原 run 的 infra 缺格清单（以 episodes.jsonl 为准，不依赖 report.json 的聚合）
const original = readFileSync(path.join(expDir, 'episodes.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as EpisodeRecord)
const infraKeys = original.filter((r) => r.success === 'infra_error').map((r) => ({ base: r.base, config_id: r.config_id, task_id: r.task_id, seed: r.seed }))
console.log(`repair targets: ${infraKeys.length} episodes (qwen=${infraKeys.filter((k) => k.base === 'qwen3-8b').length}, glm=${infraKeys.filter((k) => k.base === 'glm-4.5-air').length})`)

const repaired: EpisodeRecord[] = []
const stillInfra: Array<{ key: string; reason: string }> = []
let i = 0
for (const key of infraKeys) {
  i += 1
  const base = baseById.get(key.base)
  const config = configById.get(key.config_id)
  const task = taskById.get(key.task_id)
  if (!base || !config || !task) throw new Error(`unresolvable key ${JSON.stringify(key)}`)
  const apiKey = process.env[base.api_key_env]
  if (!apiKey) throw new Error(`missing env ${base.api_key_env}`)
  await sleep(2000) // 前置间隔，降低限流概率
  const checker = checkers[task.id]
  const check = (fs: Parameters<typeof checker>[0]['fs'], finalAnswer: string) =>
    checker({ fs, finalAnswer, toolCalls: 0, toolErrors: 0 })
  let record = await runEpisode(task, { baseId: base.id, baseUrl: base.base_url, apiKey, model: base.model, config, seed: key.seed }, check, new MockTools(fixturesByTask[task.id] ?? {}))
  if (record.success === 'infra_error') {
    console.warn(`[${i}/${infraKeys.length}] still infra: ${key.task_id} ${key.base} ${key.config_id} seed=${key.seed} (${record.failure_reason})`)
    stillInfra.push({ key: `${key.base}|${key.config_id}|${key.task_id}|${key.seed}`, reason: record.failure_reason ?? 'unknown' })
  } else {
    repaired.push(record)
    appendFileSync(path.join(expDir, 'repair-episodes.jsonl'), JSON.stringify(record) + '\n')
  }
  if (i % 10 === 0) console.log(`progress ${i}/${infraKeys.length}`)
}
console.log(`repair done: ${repaired.length} recovered, ${stillInfra.length} still infra`)

// 判据计算（协议 §5，与 run-g0.ts 同公式）：merge 口径 = 原有效数据 + 修复成功数据替换对应 infra 键
type Row = Pick<EpisodeRecord, 'base' | 'config_id' | 'task_id' | 'seed' | 'success' | 'steps'>
function criteria(rows: Row[]) {
  const cell = new Map<string, { valid: number; succ: number; steps: number }>()
  for (const r of rows) {
    if (r.success === 'infra_error') continue
    const k = `${r.base}|${r.config_id}`
    const c = cell.get(k) ?? { valid: 0, succ: 0, steps: 0 }
    c.valid += 1
    if (r.success === true) c.succ += 1
    c.steps += r.steps
    cell.set(k, c)
  }
  const rate = (b: string, c: string) => {
    const x = cell.get(`${b}|${c}`) ?? { valid: 0, succ: 0, steps: 0 }
    return { r: x.valid ? x.succ / x.valid : 0, steps: x.valid ? x.steps / x.valid : 0, n: x.valid }
  }
  const baseIds = ['deepseek-v3', 'qwen3-8b', 'glm-4.5-air']
  const cids = [...configById.keys()]
  const matrix: Record<string, Record<string, number>> = {}
  for (const b of baseIds) {
    matrix[b] = {}
    for (const c of cids) matrix[b][c] = rate(b, c).r
  }
  const gaps: Record<string, number> = {}
  const perModelBest: Record<string, string> = {}
  for (const b of baseIds) {
    const values = cids.map((c) => matrix[b][c])
    gaps[b] = Math.max(...values) - Math.min(...values)
    perModelBest[b] = [...cids].sort((x, y) => matrix[b][y] - matrix[b][x] || rate(b, x).steps - rate(b, y).steps || x.localeCompare(y))[0]
  }
  const globalMean = (c: string) => baseIds.reduce((s, b) => s + matrix[b][c], 0) / baseIds.length
  const globalSteps = (c: string) => baseIds.reduce((s, b) => s + rate(b, c).steps, 0) / baseIds.length
  const cGlobal = [...cids].sort((x, y) => globalMean(y) - globalMean(x) || globalSteps(x) - globalSteps(y) || x.localeCompare(y))[0]
  const delta = baseIds.reduce((s, b) => s + matrix[b][perModelBest[b]], 0) / baseIds.length - globalMean(cGlobal)
  const c1 = Object.values(gaps).filter((g) => g >= 0.10).length >= 2
  const c2 = delta >= 0.03
  return { matrix, gaps, perModelBest, cGlobal, delta: +delta.toFixed(4), C1: c1, C2: c2 }
}

const validOriginal: Row[] = original.filter((r) => r.success !== 'infra_error')
const merged: Row[] = [...validOriginal, ...repaired]
const originalCriteria = criteria(validOriginal)
const mergedCriteria = criteria(merged)
const report = {
  mode: 'full-repair',
  basedOn: { commit: snapshot.commit, manifestHash: snapshot.manifestHash },
  repairTargets: infraKeys.length, recovered: repaired.length, stillInfra,
  tokens: repaired.reduce((s, x) => s + x.prompt_tokens + x.completion_tokens, 0),
  criteriaOriginal: originalCriteria,
  criteriaMerged: mergedCriteria,
  note: '原始 episodes.jsonl/report.json 未改动；merge 口径 = 原有效数据 + 修复数据替换对应 infra 键。最终采纳口径待组长签字（docs/g0-decision.md）。',
}
writeFileSync(path.join(expDir, 'repair-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ original: { C1: originalCriteria.C1, C2: originalCriteria.C2, delta: originalCriteria.delta, perModelBest: originalCriteria.perModelBest }, merged: { C1: mergedCriteria.C1, C2: mergedCriteria.C2, delta: mergedCriteria.delta, perModelBest: mergedCriteria.perModelBest } }, null, 2))
