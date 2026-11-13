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
  // 迭代 2 新增 12 个任务（tool 4 / reasoning 4 / code 4），规范见 tasks/dev/README.md
  'dev-tool-03': (o) => answerIncludes(o, 'Q7-42'),
  'dev-tool-04': (o) => fileEquals(o, 'calc.txt', '60'),
  'dev-tool-05': (o) => fileEquals(o, 'orders_total.txt', '1050'),
  'dev-tool-06': (o) => fileEquals(o, 'heater.txt', 'on'),
  'dev-reas-03': (o) => answerIncludes(o, '广州'),
  'dev-reas-04': (o) => fileEquals(o, 'pop_diff.txt', '12350000'),
  'dev-reas-05': (o) => fileEquals(o, 'vip1100.txt', 'no'),
  'dev-reas-06': (o) => fileEquals(o, 'order_avg.txt', '350'),
  'dev-code-03': codeChecker([
    'maxOf([1,5,2]) === 5',
    'maxOf([-3,-1]) === -1',
    'maxOf([7]) === 7',
  ]),
  'dev-code-04': codeChecker([
    "reverseString('abc') === 'cba'",
    "reverseString('') === ''",
    "reverseString('Level') === 'leveL'",
  ]),
  'dev-code-05': codeChecker([
    'isPrime(2) === true',
    'isPrime(9) === false',
    'isPrime(1) === false',
  ]),
  'dev-code-06': codeChecker([
    'JSON.stringify(uniqueSorted([3,1,3,2])) === "[1,2,3]"',
    'JSON.stringify(uniqueSorted([])) === "[]"',
    'JSON.stringify(uniqueSorted([2,2])) === "[2]"',
  ]),
}
