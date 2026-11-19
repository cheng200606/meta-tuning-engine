// G0 判定器：标准冻结于 tasks.manifest.json 的 expected；本文件实现不得偏离。
// M3 偏离单 DEV-01：匹配方式从「严格字符串相等」改为「语义等价匹配」（answerIncludes /
// answerYesNo / answerNumber），任务指令与 expected 语义不变。
// 理由：G0 审计发现严格匹配把「答案含 yes 但不严格等于 yes」判为失败（18 集），
// 且该假象与 prompt_style 强相关，足以伪造配置敏感性（delta 5.6pp → 2.8pp）。
import { answerIncludes, answerIncludesAny, answerNumber, answerYesNo, fail, fileEquals, ok, type Checker, type EpisodeOutcome } from '../env/checker-types.ts'
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
  'g0-tool-01': (o) => fileEquals(o, 'result.txt', '1500'),
  'g0-tool-02': (o) => fileEquals(o, 'coat.txt', 'yes'),
  'g0-tool-03': (o) => answerIncludes(o, 'ORD-2026-0042'),
  'g0-tool-04': (o) => answerNumber(o, 37),
  'g0-reas-01': (o) => {
    if (!answerIncludes(o, '上海').pass) return fail('answer missing 上海')
    return answerIncludesAny(o, '12350000', '1235万').pass ? ok() : fail('answer missing 12350000 / 1235万')
  },
  'g0-reas-02': (o) => answerYesNo(o, 'yes'),
  'g0-reas-03': (o) => answerIncludes(o, '广州'),
  'g0-reas-04': (o) => fileEquals(o, 'result.txt', '17'),
  'g0-code-01': codeChecker([
    'JSON.stringify(twoSum([2,7,11,15],9).sort()) === JSON.stringify([0,1])',
    'JSON.stringify(twoSum([3,2,4],6).sort()) === JSON.stringify([1,2])',
    'JSON.stringify(twoSum([3,3],6).sort()) === JSON.stringify([0,1])',
  ]),
  'g0-code-02': codeChecker([
    "isPalindrome('level') === true",
    "isPalindrome('hello') === false",
    "isPalindrome('') === true",
    "isPalindrome('a') === true",
  ]),
  'g0-code-03': codeChecker([
    'JSON.stringify(bubbleSort([5,3,8,1])) === JSON.stringify([1,3,5,8])',
    'JSON.stringify(bubbleSort([2,2,1])) === JSON.stringify([1,2,2])',
    'JSON.stringify(bubbleSort([])) === JSON.stringify([])',
  ]),
  'g0-code-04': codeChecker([
    "JSON.stringify(parseCsvLine('a,b,c')) === JSON.stringify(['a','b','c'])",
    "JSON.stringify(parseCsvLine('a,\"b,c\",d')) === JSON.stringify(['a','b,c','d'])",
  ]),
}