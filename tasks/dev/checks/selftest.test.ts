// dev 判定器正反例自测（构造规范：先自测后入库）。每任务正/负各一。
import { describe, expect, it } from 'vitest'
import { VirtualFS } from '../../../packages/runner/src/virtual-fs.ts'
import { fixturesByTask } from '../env/fixtures.ts'
import { checkers } from './index.ts'

const fsOf = (files: Record<string, string>): VirtualFS => new VirtualFS(files)

const check = (id: string, files: Record<string, string>, finalAnswer: string): { pass: boolean; reason: string } => {
  const base = fixturesByTask[id] ?? {}
  return checkers[id]({ fs: fsOf({ ...base, ...files }), finalAnswer, toolCalls: 0, toolErrors: 0 })
}

describe('dev checkers selftest', () => {
  it('dev-tool-01: 正确总和过，错误值不过，缺文件不过', () => {
    expect(check('dev-tool-01', { 'total.txt': '180' }, '').pass).toBe(true)
    expect(check('dev-tool-01', { 'total.txt': '179' }, '').pass).toBe(false)
    expect(check('dev-tool-01', {}, '').pass).toBe(false)
  })

  it('dev-tool-02: 广州 24℃ → no；no 以外值与缺失不过', () => {
    expect(check('dev-tool-02', { 'jacket.txt': 'no' }, '').pass).toBe(true)
    expect(check('dev-tool-02', { 'jacket.txt': 'yes' }, '').pass).toBe(false)
    expect(check('dev-tool-02', {}, '').pass).toBe(false)
  })

  it('dev-reas-01: 答案含杭州过；含上海不过；空答案不过', () => {
    expect(check('dev-reas-01', {}, '人口较少的城市是杭州').pass).toBe(true)
    expect(check('dev-reas-01', {}, '人口较少的城市是上海').pass).toBe(false)
    expect(check('dev-reas-01', {}, '').pass).toBe(false)
  })

  it('dev-reas-02: z=26 过；错误值与缺失不过', () => {
    expect(check('dev-reas-02', { 'z.txt': '26' }, '').pass).toBe(true)
    expect(check('dev-reas-02', { 'z.txt': '44' }, '').pass).toBe(false)
    expect(check('dev-reas-02', {}, '').pass).toBe(false)
  })

  it('dev-code-01: 过滤负数求和；缺解不过；错解不过', () => {
    const good = 'function sumPositive(n){return n.filter(x=>x>0).reduce((a,b)=>a+b,0)}'
    const bad = 'function sumPositive(n){return n.reduce((a,b)=>a+b,0)}'
    expect(check('dev-code-01', { 'solution.js': good }, '').pass).toBe(true)
    expect(check('dev-code-01', {}, '').pass).toBe(false)
    expect(check('dev-code-01', { 'solution.js': bad }, '').pass).toBe(false)
  })

  it('dev-code-02: 大小写不敏感元音计数；缺解不过；大小写敏感错解不过', () => {
    const good = "function countVowels(s){return (s.match(/[aeiou]/gi)||[]).length}"
    const bad = "function countVowels(s){return (s.match(/[aeiou]/g)||[]).length}"
    expect(check('dev-code-02', { 'solution.js': good }, '').pass).toBe(true)
    expect(check('dev-code-02', {}, '').pass).toBe(false)
    expect(check('dev-code-02', { 'solution.js': bad }, '').pass).toBe(false)
  })
})
