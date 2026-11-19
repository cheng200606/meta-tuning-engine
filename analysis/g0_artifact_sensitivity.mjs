// 诚实检验（一次性分析，不入库）：G0 头条结论对「测量假象」的敏感性。
// 问题：严格答案匹配（要求答案恰为 'yes'）与 vm×CommonJS 环境失败，是与配置质量无关的
// 测量误差。它们若在配置间分布不均，就会伪造出「配置敏感性」。
// 做法：把失败分三类，逐档重算 delta（悲观 / 原样 / 乐观）。
import { readFileSync } from 'node:fs'

const dir = 'experiments/2026-11-10-m1-g0-full/'
const orig = readFileSync(dir + 'episodes.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const rep = readFileSync(dir + 'repair-episodes.jsonl', 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const repKeys = new Set(rep.map((r) => `${r.base}|${r.config_id}|${r.task_id}|${r.seed}`))
const merged = [
  ...orig.filter((r) => !(r.success === 'infra_error' && repKeys.has(`${r.base}|${r.config_id}|${r.task_id}|${r.seed}`))),
  ...rep,
].filter((r) => r.success !== 'infra_error')

const BASES = ['deepseek-v3', 'qwen3-8b', 'glm-4.5-air']
const CIDS = ['concise-p1-roff','concise-p2-roff','concise-p3-roff','step_by_step-p1-roff','step_by_step-p2-roff','step_by_step-p3-roff','constrained-p1-roff','constrained-p2-roff','constrained-p3-roff']

// 失败分类
function classify(r) {
  const f = r.failure_reason ?? ''
  if (r.success === true) return 'pass'
  if (f.startsWith('vm error: ReferenceError: module is not defined')) return 'env_artifact' // CommonJS 导出习惯
  if (f.startsWith('expected yes, got') && /yes/i.test(f)) return 'format_artifact' // 答案含 yes 但不严格等于 yes
  if (f.startsWith('expected 37.0 or 37, got')) return 'format_artifact_empty' // 空答案（真实失败）
  if (f.startsWith('answer missing')) return 'content_missing'
  if (f.startsWith('file missing')) return 'content_missing'
  if (f.startsWith('max_steps')) return 'max_steps'
  return 'other'
}
const tally = {}
for (const r of merged) { const c = classify(r); tally[c] = (tally[c] ?? 0) + 1 }
console.log('=== 648 集失败分类 ===')
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v} (${(v / merged.length * 100).toFixed(1)}%)`)

// 逐档重算：悲观=把 artifact 记为失败(原样)；乐观=把 artifact 记为成功
function criteria(treatArtifactAsPass) {
  const cell = {}
  for (const r of merged) {
    const c = classify(r)
    let ok = c === 'pass'
    if (treatArtifactAsPass && (c === 'env_artifact' || c === 'format_artifact')) ok = true
    const k = `${r.base}|${r.config_id}`
    cell[k] ??= { n: 0, ok: 0 }
    cell[k].n += 1
    if (ok) cell[k].ok += 1
  }
  const rate = (b, c) => (cell[`${b}|${c}`]?.ok ?? 0) / (cell[`${b}|${c}`]?.n ?? 1)
  const gaps = {}, pmb = {}
  for (const b of BASES) {
    const v = CIDS.map((c) => rate(b, c))
    gaps[b] = Math.max(...v) - Math.min(...v)
    pmb[b] = [...CIDS].sort((x, y) => rate(b, y) - rate(b, x) || x.localeCompare(y))[0]
  }
  const gm = (c) => BASES.reduce((s, b) => s + rate(b, c), 0) / BASES.length
  const cg = [...CIDS].sort((x, y) => gm(y) - gm(x) || x.localeCompare(y))[0]
  const delta = BASES.reduce((s, b) => s + rate(b, pmb[b]), 0) / BASES.length - gm(cg)
  const c1 = Object.values(gaps).filter((g) => g >= 0.10).length >= 2
  return { gaps, pmb, cg, delta, c1, c2: delta >= 0.03 }
}
const pessimistic = criteria(false)
const optimistic = criteria(true)
console.log('\n=== 测量假象敏感性 ===')
for (const [label, r] of [['原样（artifact 记为失败）', pessimistic], ['乐观（artifact 记为成功）', optimistic]]) {
  console.log(`  ${label}:`)
  console.log(`    gap: ${BASES.map((b) => `${b}=${r.gaps[b].toFixed(3)}`).join('  ')}`)
  console.log(`    delta = ${r.delta.toFixed(4)}  C1=${r.c1}  C2=${r.c2}`)
  console.log(`    per-model best: ${JSON.stringify(r.pmb)}  c_global=${r.cg}`)
}
// artifact 在各配置间的分布是否均匀（若不均 → 假象确实在驱动结论）
console.log('\n=== artifact 分布（各配置 artifact 率）===')
for (const b of BASES) {
  const line = CIDS.map((c) => {
    const rows = merged.filter((r) => r.base === b && r.config_id === c)
    const art = rows.filter((r) => ['env_artifact', 'format_artifact'].includes(classify(r))).length
    return `${c.replace('-roff', '').replace('step_by_step', 'sbs')}=${(art / rows.length).toFixed(2)}`
  })
  console.log(`  ${b}: ${line.join(' ')}`)
}
