// dev 任务集判定器：实现遵循 tasks/dev/README.md 构造规范，expected 以 manifest 为准。
// 复用 g0 的 checker-types 公共断言与 codeChecker 模式。
import { answerIncludes, fail, fileEquals, ok, type Checker, type EpisodeOutcome } from '../../g0/env/checker-types.ts'
import { runJsAssertions } from '../../../packages/runner/src/run-js.ts'

function solution(outcome: EpisodeOutcome): string | null {
  try {
    return outcome.fs.read('solution.js')
  } catch {
    return null
  }
}

function codeChecker(assertions: string[]): Checker {
  return (outcome) => {
    const code = solution(outcome)
    if (code === null) return fail('solution.js missing')
    return runJsAssertions(code, assertions)
  }
}

export const checkers: Record<string, Checker> = {
  'dev-tool-01': (o) => fileEquals(o, 'total.txt', '180'),
  'dev-tool-02': (o) => fileEquals(o, 'jacket.txt', 'no'),
  'dev-reas-01': (o) => answerIncludes(o, '杭州'),
  'dev-reas-02': (o) => fileEquals(o, 'z.txt', '26'),
  'dev-code-01': codeChecker([
    'sumPositive([1,-2,3]) === 4',
    'sumPositive([-1,-2]) === 0',
    'sumPositive([]) === 0',
  ]),
  'dev-code-02': codeChecker([
    "countVowels('hello') === 2",
    "countVowels('XYZ') === 0",
    "countVowels('Audio') === 4",
  ]),
}
