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

  // 迭代 2 新增 12 个任务：每任务正例 / 反例 / 缺文件（缺解）
  it('dev-tool-03: 答案含正确 ticket 过；错值与空答案不过', () => {
    expect(check('dev-tool-03', {}, 'ticket 的值是 Q7-42').pass).toBe(true)
    expect(check('dev-tool-03', {}, 'ticket 的值是 Q7-99').pass).toBe(false)
    expect(check('dev-tool-03', {}, '').pass).toBe(false)
  })

  it('dev-tool-04: 60 过；错值与缺文件不过', () => {
    expect(check('dev-tool-04', { 'calc.txt': '60' }, '').pass).toBe(true)
    expect(check('dev-tool-04', { 'calc.txt': '40' }, '').pass).toBe(false)
    expect(check('dev-tool-04', {}, '').pass).toBe(false)
  })

  it('dev-tool-05: 订单总额 1050 过；错值与缺文件不过', () => {
    expect(check('dev-tool-05', { 'orders_total.txt': '1050' }, '').pass).toBe(true)
    expect(check('dev-tool-05', { 'orders_total.txt': '750' }, '').pass).toBe(false)
    expect(check('dev-tool-05', {}, '').pass).toBe(false)
  })

  it('dev-tool-06: 上海 12℃ → on；off 与缺文件不过', () => {
    expect(check('dev-tool-06', { 'heater.txt': 'on' }, '').pass).toBe(true)
    expect(check('dev-tool-06', { 'heater.txt': 'off' }, '').pass).toBe(false)
    expect(check('dev-tool-06', {}, '').pass).toBe(false)
  })

  it('dev-reas-03: 最暖城市广州过；北京与空答案不过', () => {
    expect(check('dev-reas-03', {}, '气温最高的城市是广州').pass).toBe(true)
    expect(check('dev-reas-03', {}, '气温最高的城市是北京').pass).toBe(false)
    expect(check('dev-reas-03', {}, '').pass).toBe(false)
  })

  it('dev-reas-04: 人口差 12350000 过；错值与缺文件不过', () => {
    expect(check('dev-reas-04', { 'pop_diff.txt': '12350000' }, '').pass).toBe(true)
    expect(check('dev-reas-04', { 'pop_diff.txt': '1235000' }, '').pass).toBe(false)
    expect(check('dev-reas-04', {}, '').pass).toBe(false)
  })

  it('dev-reas-05: 1050 ≤ 1100 → no；yes 与缺文件不过', () => {
    expect(check('dev-reas-05', { 'vip1100.txt': 'no' }, '').pass).toBe(true)
    expect(check('dev-reas-05', { 'vip1100.txt': 'yes' }, '').pass).toBe(false)
    expect(check('dev-reas-05', {}, '').pass).toBe(false)
  })

  it('dev-reas-06: 平均订单额 350 过；错值与缺文件不过', () => {
    expect(check('dev-reas-06', { 'order_avg.txt': '350' }, '').pass).toBe(true)
    expect(check('dev-reas-06', { 'order_avg.txt': '1050' }, '').pass).toBe(false)
    expect(check('dev-reas-06', {}, '').pass).toBe(false)
  })

  it('dev-code-03: maxOf 取最大值；缺解不过；取最小值错解不过', () => {
    const good = 'function maxOf(n){return Math.max(...n)}'
    const bad = 'function maxOf(n){return Math.min(...n)}'
    expect(check('dev-code-03', { 'solution.js': good }, '').pass).toBe(true)
    expect(check('dev-code-03', {}, '').pass).toBe(false)
    expect(check('dev-code-03', { 'solution.js': bad }, '').pass).toBe(false)
  })

  it('dev-code-04: reverseString 反转；缺解不过；原样返回错解不过', () => {
    const good = "function reverseString(s){return s.split('').reverse().join('')}"
    const bad = 'function reverseString(s){return s}'
    expect(check('dev-code-04', { 'solution.js': good }, '').pass).toBe(true)
    expect(check('dev-code-04', {}, '').pass).toBe(false)
    expect(check('dev-code-04', { 'solution.js': bad }, '').pass).toBe(false)
  })

  it('dev-code-05: isPrime 判定；缺解不过；恒真错解不过', () => {
    const good = 'function isPrime(n){if(n<2)return false;for(let i=2;i*i<=n;i++)if(n%i===0)return false;return true}'
    const bad = 'function isPrime(n){return true}'
    expect(check('dev-code-05', { 'solution.js': good }, '').pass).toBe(true)
    expect(check('dev-code-05', {}, '').pass).toBe(false)
    expect(check('dev-code-05', { 'solution.js': bad }, '').pass).toBe(false)
  })

  it('dev-code-06: uniqueSorted 去重升序；缺解不过；不去重错解不过', () => {
    const good = 'function uniqueSorted(n){return [...new Set(n)].sort((a,b)=>a-b)}'
    const bad = 'function uniqueSorted(n){return n.sort((a,b)=>a-b)}'
    expect(check('dev-code-06', { 'solution.js': good }, '').pass).toBe(true)
    expect(check('dev-code-06', {}, '').pass).toBe(false)
    expect(check('dev-code-06', { 'solution.js': bad }, '').pass).toBe(false)
  })
})
