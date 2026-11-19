// G0 测量效度审计（修订版，2026-11-19）：修正先前对 artifact 的高估。
// 先前版本把全部 36 例 "expected yes, got ..." 记为格式假象；实际其中 18 例答案是空串
// （模型未作答，属真实失败），真格式假象仅 18 例。本文件按修正后的分类重算三档。
import { readFileSync } from 'node:fs'
import { canonicalNumbers, canonicalYesNo } from '../packages/runner/src/answer-normalize.ts'

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
  try { return JSON.parse(m[1]) as string } catch { return null }
}

type Kind = 'pass' | 'format_artifact' | 'env_artifact' | 'empty_answer' | 'substantive'
function classify(r: (typeof merged)[number]): Kind {
  const f = r.failure_reason ?? ''
  if (r.success === true) return 'pass'
  if (f.startsWith('vm error: ReferenceError: module is not defined')) return 'env_artifact'
  if (f.startsWith('expected yes, got')) {
    const raw = rawOf(f) ?? ''
    if (raw.trim() === '') return 'empty_answer'
    return canonicalYesNo(raw) === 'yes' ? 'format_artifact' : 'substantive'
  }
  if (f.startsWith('expected 37.0 or 37, got')) {
    const raw = rawOf(f) ?? ''
    return raw.trim() === '' ? 'empty_answer' : (canonicalNumbers(raw).includes(37) ? 'format_artifact' : 'substantive')
  }
  if (f.startsWith('answer missing') || f.startsWith('file missing') || f.startsWith('max_steps')) return 'substantive'
  return 'substantive'
}

const tally: Record<string, number> = {}
for (const r of merged) { const k = classify(r); tally[k] = (tally[k] ?? 0) + 1 }
console.log('=== 修正后的失败分类（648 集）===')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${v} (${(v / merged.length * 100).toFixed(1)}%)`)

const BASES = ['deepseek-v3', 'qwen3-8b', 'glm-4.5-air']
const CIDS = ['concise-p1-roff','concise-p2-roff','concise-p3-roff','step_by_step-p1-roff','step_by_step-p2-roff','step_by_step-p3-roff','constrained-p1-roff','constrained-p2-roff','constrained-p3-roff']

function criteria(forgive: Kind[]) {
  const cell: Record<string, { n: number; ok: number }> = {}
  for (const r of merged) {
    const k = `${r.base}|${r.config_id}`
    cell[k] ??= { n: 0, ok: 0 }
    cell[k].n += 1
    const kind = classify(r)
    if (kind === 'pass' || forgive.includes(kind)) cell[k].ok += 1
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
  return { gaps, pmb, cg, delta, C1: Object.values(gaps).filter((g) => g >= 0.1).length >= 2, C2: delta >= 0.03 }
}

const s0 = criteria([])
const s1 = criteria(['format_artifact'])
const s2 = criteria(['format_artifact', 'env_artifact'])
console.log('\n=== 三档敏感性（原轨迹重算，非重跑结果）===')
for (const [label, r] of [
  ['S0 原样（artifact 记为失败）', s0],
  ['S1 仅判定器健壮化', s1],
  ['S2 判定器 + CommonJS shim（上界）', s2],
] as const) {
  console.log(`  ${label}`)
  console.log(`    gap: ${BASES.map((b) => `${b}=${r.gaps[b].toFixed(3)}`).join('  ')}`)
  console.log(`    delta=${r.delta.toFixed(4)}  c_global=${r.cg}  C1=${r.C1}  C2=${r.C2}`)
  console.log(`    perModelBest=${JSON.stringify(r.pmb)}`)
}
console.log('\n=== artifact 在配置间的分布（artifact 率）===')
for (const b of BASES) {
  const line = CIDS.map((c) => {
    const rows = merged.filter((r) => r.base === b && r.config_id === c)
    const art = rows.filter((r) => ['env_artifact', 'format_artifact'].includes(classify(r))).length
    return `${c.replace('-roff', '').replace('step_by_step', 'sbs')}=${(art / rows.length).toFixed(2)}`
  })
  console.log(`  ${b}: ${line.join(' ')}`)
}
