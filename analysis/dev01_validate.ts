// DEV-01 零成本验证：用 G0 冻结数据里的真实 artifact 答案串，检查新归一化器能否正确改判。
import { readFileSync } from 'node:fs'
import { canonicalNumbers, canonicalYesNo, normalizeAnswer } from '../packages/runner/src/answer-normalize.ts'

const dir = 'experiments/2026-11-10-m1-g0-full/'
const orig = readFileSync(dir + 'episodes.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const rep = readFileSync(dir + 'repair-episodes.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const keys = new Set(rep.map((r) => `${r.base}|${r.config_id}|${r.task_id}|${r.seed}`))
const merged = [
  ...orig.filter((r) => !(r.success === 'infra_error' && keys.has(`${r.base}|${r.config_id}|${r.task_id}|${r.seed}`))),
  ...rep,
].filter((r) => r.success !== 'infra_error')

function rawOf(reason: string): string | null {
  const m = /got (".*")$/s.exec(reason)
  if (m === null) return null
  try {
    return JSON.parse(m[1]) as string
  } catch {
    return null
  }
}

const yesArtifacts = merged.filter((r) => (r.failure_reason ?? '').startsWith('expected yes, got'))
let fixed = 0
let stillFail = 0
let ambiguous = 0
const ambiguousSamples: string[] = []
const failedSamples: string[] = []
for (const r of yesArtifacts) {
  const raw = rawOf(r.failure_reason ?? '')
  if (raw === null) {
    stillFail += 1
    continue
  }
  const verdict = canonicalYesNo(raw)
  const tokens = normalizeAnswer(raw).match(/\b(yes|no|true|false)\b/gi) ?? []
  const distinct = new Set(tokens.map((t) => t.toLowerCase()))
  if (distinct.size > 1) {
    ambiguous += 1
    ambiguousSamples.push(`${r.task_id} tokens=${JSON.stringify(tokens)} -> ${verdict} :: ${raw.replace(/\n/g, ' ').slice(0, 100)}`)
  }
  if (verdict === 'yes') fixed += 1
  else {
    stillFail += 1
    failedSamples.push(`${r.task_id} verdict=${verdict} :: ${raw.replace(/\n/g, ' ').slice(0, 100)}`)
  }
}
console.log(`[yes 严格匹配 artifact] 样本 ${yesArtifacts.length}：改判 yes ${fixed}，仍失败 ${stillFail}，含多词元歧义 ${ambiguous}`)
for (const s of ambiguousSamples.slice(0, 6)) console.log('  AMBIG ' + s)
for (const s of failedSamples.slice(0, 6)) console.log('  FAIL  ' + s)

const tool04 = merged.filter((r) => r.task_id === 'g0-tool-04' && r.success !== true)
console.log(`\n[g0-tool-04] 失败样本 ${tool04.length}（原判定要求严格等于 37.0/37）`)
for (const r of tool04.slice(0, 8)) {
  const raw = rawOf(r.failure_reason ?? '') ?? ''
  console.log(`  新判定=${canonicalNumbers(raw).includes(37) ? 'PASS' : 'FAIL'} raw=${raw.replace(/\n/g, ' ').slice(0, 90)}`)
}

// 全量：若把所有 artifact 按新判定重算，各基座完成率会变成多少
const BASES = ['deepseek-v3', 'qwen3-8b', 'glm-4.5-air']
const CIDS = ['concise-p1-roff','concise-p2-roff','concise-p3-roff','step_by_step-p1-roff','step_by_step-p2-roff','step_by_step-p3-roff','constrained-p1-roff','constrained-p2-roff','constrained-p3-roff']
const cell = {}
for (const r of merged) {
  const k = `${r.base}|${r.config_id}`
  cell[k] ??= { n: 0, ok: 0 }
  cell[k].n += 1
  let ok = r.success === true
  if (!ok) {
    const f = r.failure_reason ?? ''
    const raw = rawOf(f)
    if (f.startsWith('expected yes, got') && raw !== null && canonicalYesNo(raw) === 'yes') ok = true
    if (f.startsWith('expected 37.0 or 37, got') && raw !== null && canonicalNumbers(raw).includes(37)) ok = true
  }
  if (ok) cell[k].ok += 1
}
const rate = (b: string, c: string) => (cell[`${b}|${c}`]?.ok ?? 0) / (cell[`${b}|${c}`]?.n ?? 1)
const gaps: Record<string, number> = {}
const pmb: Record<string, string> = {}
for (const b of BASES) {
  const v = CIDS.map((c) => rate(b, c))
  gaps[b] = Math.max(...v) - Math.min(...v)
  pmb[b] = [...CIDS].sort((x, y) => rate(b, y) - rate(b, x) || x.localeCompare(y))[0]
}
const gm = (c: string) => BASES.reduce((s, b) => s + rate(b, c), 0) / BASES.length
const cg = [...CIDS].sort((x, y) => gm(y) - gm(x) || x.localeCompare(y))[0]
const delta = BASES.reduce((s, b) => s + rate(b, pmb[b]), 0) / BASES.length - gm(cg)
console.log('\n[仅修判定器、仍用原轨迹的重算]')
console.log(`  gap: ${BASES.map((b) => `${b}=${gaps[b].toFixed(3)}`).join('  ')}`)
console.log(`  delta=${delta.toFixed(4)}  c_global=${cg}  perModelBest=${JSON.stringify(pmb)}`)
console.log(`  C1=${Object.values(gaps).filter((g) => g >= 0.1).length >= 2}  C2=${delta >= 0.03}`)
