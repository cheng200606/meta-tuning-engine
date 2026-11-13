// test 保留集判定器：expected 以 tasks/test/manifest.json 为准（已冻结）。
// 复用 g0 checker-types 公共断言与 codeChecker 模式；与 dev/g0 任务零语义重叠。
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

function numAnswer(outcome: EpisodeOutcome, expected: string): { pass: boolean; reason: string } {
  return outcome.finalAnswer.includes(expected) ? ok() : fail(`answer missing ${expected}`)
}

function yesNo(outcome: EpisodeOutcome, expected: 'yes' | 'no'): { pass: boolean; reason: string } {
  return outcome.finalAnswer.toLowerCase().includes(expected) ? ok() : fail(`answer missing ${expected}`)
}

export const checkers: Record<string, Checker> = {
  'test-tool-01': (o) => numAnswer(o, '30'),
  'test-tool-02': (o) => fileEquals(o, 'status.txt', 'delivered'),
  'test-tool-03': (o) => fileEquals(o, 'sh_temp.txt', '12'),
  'test-tool-04': (o) => numAnswer(o, '42'),
  'test-tool-05': (o) => fileEquals(o, 'r50.txt', '50'),
  'test-tool-06': (o) => fileEquals(o, 'pop.txt', '24870000'),
  'test-tool-07': (o) => fileEquals(o, 'second_order.txt', '450'),
  'test-tool-08': (o) => fileEquals(o, 'last.txt', 'gamma'),
  'test-tool-09': (o) => fileEquals(o, 'six.txt', '6'),
  'test-tool-10': (o) => fileEquals(o, 'temp_of_city.txt', '24'),

  'test-reas-01': (o) => numAnswer(o, '19'),
  'test-reas-02': (o) => numAnswer(o, '300'),
  'test-reas-03': (o) => yesNo(o, 'yes'),
  'test-reas-04': (o) => fileEquals(o, 'product.txt', '24'),
  'test-reas-05': (o) => answerIncludes(o, '上海'),
  'test-reas-06': (o) => yesNo(o, 'yes'),
  'test-reas-07': (o) => answerIncludes(o, '上海'),
  'test-reas-08': (o) => fileEquals(o, 'square.txt', '36'),
  'test-reas-09': (o) => yesNo(o, 'yes'),
  'test-reas-10': (o) => answerIncludes(o, '上海'),

  'test-code-01': codeChecker([
    'sumRange(1,3) === 6',
    'sumRange(2,2) === 2',
    'sumRange(4,2) === 0',
  ]),
  'test-code-02': codeChecker([
    "countChar('banana','a') === 3",
    "countChar('bbb','a') === 0",
    "countChar('','a') === 0",
  ]),
  'test-code-03': codeChecker([
    'JSON.stringify(minMax([4,1,9])) === JSON.stringify([1,9])',
    'JSON.stringify(minMax([7])) === JSON.stringify([7,7])',
    'JSON.stringify(minMax([2,2])) === JSON.stringify([2,2])',
  ]),
  'test-code-04': codeChecker([
    'isEven(4) === true',
    'isEven(7) === false',
    'isEven(0) === true',
  ]),
  'test-code-05': codeChecker([
    "firstWord('hello world') === 'hello'",
    "firstWord('solo') === 'solo'",
    "firstWord('  lead') === 'lead'",
  ]),
  'test-code-06': codeChecker([
    'dupCount([1,2,2,3,3,3]) === 2',
    'dupCount([1,2]) === 0',
    'dupCount([]) === 0',
  ]),
  'test-code-07': codeChecker([
    "swapCase('aBc') === 'AbC'",
    "swapCase('X') === 'x'",
    "swapCase('123') === '123'",
  ]),
  'test-code-08': codeChecker([
    'JSON.stringify(lastN([1,2,3,4],2)) === JSON.stringify([3,4])',
    'JSON.stringify(lastN([1],3)) === JSON.stringify([1])',
    'JSON.stringify(lastN([],1)) === JSON.stringify([])',
  ]),
  'test-code-09': codeChecker([
    'digitSum(123) === 6',
    'digitSum(0) === 0',
    'digitSum(907) === 16',
  ]),
  'test-code-10': codeChecker([
    "padZeros('7',3) === '007'",
    "padZeros('42',2) === '42'",
    "padZeros('',3) === '000'",
  ]),
}
