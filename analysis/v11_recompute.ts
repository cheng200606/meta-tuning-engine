// G0 v1.1 重跑判据独立重算：不依赖 run-g0.ts 的 report.json，直接从 episodes.jsonl 重算 C1/C2，
// 并与 DEV-01 预期区间（delta 0.000–0.028）对照。协议 §6 要求 report 必含 C1/C2 —— 本脚本是其独立复核。
import { readFileSync } from 'node:fs'

const dir = process.argv[2] ?? 'experiments/2026-11-19-m1-g0-full/'
const rows = readFileSync(dir + 'episodes.jsonl', 'utf8').trim().split('\n').filter((l) => l.length > 0).map((l) => JSON.parse(l))
console.log(`episodes: ${rows.length} (dir=${dir})`)

const BASES = ['deepseek-v3', 'qwen3-8b', 'glm-4.5-air']
const CIDS = [
  'concise-p1-roff', 'concise-p2-roff', 'concise-p3-roff',
  'step_by_step-p1-roff', 'step_by_step-p2-roff', 'step_by_step-p3-roff',
  'constrained-p1-roff', 'constrained-p2-roff', 'constrained-p3-roff',
]

const valid = rows.filter((r) => r.success !== 'infra_error')
const infra = rows.length - valid.length

const cell = new Map<string, { n: number; ok: number; steps: number }>()
for (const r of valid) {
  const k = `${r.base}|${r.config_id}`
  const c = cell.get(k) ?? { n: 0, ok: 0, steps: 0 }
  c.n += 1
  if (r.success === true) c.ok += 1
  c.steps += r.steps
  cell.set(k, c)
}
const rate = (b: string, c: string) => {
  const x = cell.get(`${b}|${c}`) ?? { n: 0, ok: 0, steps: 0 }
  return { r: x.n === 0 ? 0 : x.ok / x.n, steps: x.n === 0 ? 0 : x.steps / x.n, n: x.n }
}

const gaps: Record<string, number> = {}
const pmb: Record<string, string> = {}
for (const b of BASES) {
  const v = CIDS.map((c) => rate(b, c).r)
  gaps[b] = Math.max(...v) - Math.min(...v)
  pmb[b] = [...CIDS].sort((x, y) => rate(b, y).r - rate(b, x).r || rate(b, x).steps - rate(b, y).steps || x.localeCompare(y))[0]
}
const gmean = (c: string) => BASES.reduce((s, b) => s + rate(b, c).r, 0) / BASES.length
const gsteps = (c: string) => BASES.reduce((s, b) => s + rate(b, c).steps, 0) / BASES.length
const cGlobal = [...CIDS].sort((x, y) => gmean(y) - gmean(x) || gsteps(x) - gsteps(y) || x.localeCompare(y))[0]
const delta = BASES.reduce((s, b) => s + rate(b, pmb[b]).r, 0) / BASES.length - gmean(cGlobal)
const C1 = Object.values(gaps).filter((g) => g >= 0.10).length >= 2
const C2 = delta >= 0.03

console.log(`infra_error: ${infra}（协议 §2 纪律：不计入指标）`)
console.log('\nr(b,c) 矩阵：')
console.log('  config'.padEnd(24) + BASES.map((b) => b.slice(0, 10).padEnd(11)).join(''))
for (const c of CIDS) {
  const line = CIDS.includes(c) ? BASES.map((b) => rate(b, c).r.toFixed(3).padEnd(11)).join('') : ''
  console.log(`  ${c.padEnd(22)}${line}`)
}
console.log('\nper-model best:', JSON.stringify(pmb))
console.log('c_global:', cGlobal, `(跨基座均值 ${gmean(cGlobal).toFixed(3)})`)
console.log('delta:', delta.toFixed(4), '（DEV-01 预期区间 0.000–0.028）')
console.log('gaps:', JSON.stringify(Object.fromEntries(BASES.map((b) => [b, +gaps[b].toFixed(4)]))))
console.log(`C1=${C1}  C2=${C2}`)
console.log(`decision: ${C1 && C2 ? 'PASS -> 基座感知前提成立' : C1 ? 'C1 成立、C2 不成立 → 主张修订为「配置敏感性成立，跨基座差异化不成立」' : 'STOP'}`)

// 交叉验证 run-g0.ts 的 report.json（若已生成）
try {
  const report = JSON.parse(readFileSync(dir + 'report.json', 'utf8')) as {
    matrix: Record<string, Record<string, number>>; gaps: Record<string, number>; delta: number; C1: boolean; C2: boolean
  }
  const matrixOk = BASES.every((b) => CIDS.every((c) => Math.abs(report.matrix[b][c] - rate(b, c).r) < 1e-9))
  console.log('\nreport.json 交叉验证：matrix', matrixOk ? '一致 ✓' : '不一致 ✗',
    '| gaps', BASES.every((b) => Math.abs(report.gaps[b] - gaps[b]) < 1e-9) ? '一致 ✓' : '不一致 ✗',
    '| delta', Math.abs(report.delta - delta) < 1e-9 ? '一致 ✓' : '不一致 ✗',
    '| C1/C2', report.C1 === C1 && report.C2 === C2 ? '一致 ✓' : '不一致 ✗')
} catch { /* report 尚未生成 */ }
