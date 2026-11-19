// 判定器公共类型与断言工具（g0 / dev / test 三套任务集共用）。
// M3 偏离单 DEV-01：匹配从「字符串严格相等」改为「语义等价匹配」——
// G0 审计发现严格匹配把「答案含 yes 但不严格等于 yes」判为失败（18 集），
// 该假象与 prompt_style 强相关，足以伪造配置敏感性。
// 任务指令与 manifest 的 expected 语义不变；只改「如何把回答与期望对上」。
import type { VirtualFS } from '../../../packages/runner/src/virtual-fs.ts'
import { answerHasNumber, canonicalYesNo, normalizeAnswer } from '../../../packages/runner/src/answer-normalize.ts'

export interface EpisodeOutcome {
  fs: VirtualFS
  finalAnswer: string
  toolCalls: number
  toolErrors: number
}

export type Checker = (outcome: EpisodeOutcome) => { pass: boolean; reason: string }

export function ok(): { pass: boolean; reason: string } {
  return { pass: true, reason: 'ok' }
}

export function fail(reason: string): { pass: boolean; reason: string } {
  return { pass: false, reason }
}

export function fileEquals(outcome: EpisodeOutcome, file: string, expected: string): { pass: boolean; reason: string } {
  let actual: string
  try {
    actual = outcome.fs.read(file).trim()
  } catch {
    return fail(`file missing: ${file}`)
  }
  return actual === expected ? ok() : fail(`${file}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

/** 答案包含 needle（归一化后比较：剥离 markdown 强调、全角→半角、去千分位）。 */
export function answerIncludes(outcome: EpisodeOutcome, ...needles: string[]): { pass: boolean; reason: string } {
  const haystack = normalizeAnswer(outcome.finalAnswer)
  const missing = needles.filter((n) => !haystack.includes(normalizeAnswer(n)))
  return missing.length === 0 ? ok() : fail(`answer missing: ${missing.join(', ')}`)
}

/** 答案命中 needle 之一（归一化后比较）——用于「12350000 或 1235万」这类等价表述。 */
export function answerIncludesAny(outcome: EpisodeOutcome, ...needles: string[]): { pass: boolean; reason: string } {
  const haystack = normalizeAnswer(outcome.finalAnswer)
  const hit = needles.filter((n) => haystack.includes(normalizeAnswer(n)))
  return hit.length > 0 ? ok() : fail(`answer missing any of: ${needles.join(', ')}`)
}

/** 答案给出 yes/no 判定（取最后一个独立判定词元；兼容中文 是/否，排除「是否/不是/否则」）。 */
export function answerYesNo(outcome: EpisodeOutcome, expected: 'yes' | 'no'): { pass: boolean; reason: string } {
  const verdict = canonicalYesNo(outcome.finalAnswer)
  if (verdict === null) return fail(`answer has no yes/no verdict (expected ${expected})`)
  return verdict === expected ? ok() : fail(`expected ${expected}, got ${verdict}`)
}

/** 答案包含期望数值（任一出现的数字等于期望值即命中；避免「98.6 华氏 = 37 摄氏度」被误杀）。 */
export function answerNumber(outcome: EpisodeOutcome, expected: number): { pass: boolean; reason: string } {
  return answerHasNumber(outcome.finalAnswer, expected)
    ? ok()
    : fail(`answer missing number ${expected}, got ${JSON.stringify(normalizeAnswer(outcome.finalAnswer).slice(0, 80))}`)
}
