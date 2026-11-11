// G0 判据计算（协议 §5），主流水线与修复跑共用，禁止分叉。
// infra_error 不计入指标；平局规则：平均步数更低 → config_id 字典序。

export interface ReportRecord {
  base: string
  config_id: string
  success: boolean | 'infra_error'
  steps: number
  prompt_tokens: number
  completion_tokens: number
}

export interface InfraFailure {
  task: string
  base: string
  config: string
  seed: number
  reason: string
}

export interface G0Report {
  mode: string
  date: string
  episodes: number
  infraFailures: InfraFailure[]
  matrix: Record<string, Record<string, number>>
  gaps: Record<string, number>
  perModelBest: Record<string, string>
  cGlobal: string
  delta: number
  C1: boolean
  C2: boolean
  decision: string
  tokens: number
}

export function computeG0Report(input: {
  records: ReportRecord[]
  baseIds: string[]
  cids: string[]
  mode: string
  infraFailures: InfraFailure[]
}): G0Report {
  const { records, baseIds, cids, mode, infraFailures } = input
  function rate(baseId: string, cid: string): { r: number; steps: number; n: number } {
    const rows = records.filter((x) => x.base === baseId && x.config_id === cid && x.success !== 'infra_error')
    const n = rows.length
    const r = n === 0 ? 0 : rows.filter((x) => x.success === true).length / n
    const steps = n === 0 ? 0 : rows.reduce((s, x) => s + x.steps, 0) / n
    return { r, steps, n }
  }
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
  return {
    mode, date: new Date().toISOString(), episodes: records.length, infraFailures,
    matrix, gaps, perModelBest, cGlobal, delta, C1: c1, C2: c2,
    decision: mode.startsWith('full') ? (c1 && c2 ? 'PASS -> M2' : c1 ? 'DOWNGRADE (C1 only)' : 'STOP') : `${mode}-only (no decision)`,
    tokens: records.reduce((s, x) => s + x.prompt_tokens + x.completion_tokens, 0),
  }
}