// G0 判定器公共类型与断言工具。判定标准冻结于 tasks.manifest.json 的 expected 字段。
import type { VirtualFS } from './virtual-fs.ts'

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

export function answerIncludes(outcome: EpisodeOutcome, ...needles: string[]): { pass: boolean; reason: string } {
  const missing = needles.filter((n) => !outcome.finalAnswer.includes(n))
  return missing.length === 0 ? ok() : fail(`answer missing: ${missing.join(', ')}`)
}