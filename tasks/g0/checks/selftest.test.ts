// 判定器自测：每任务正例/反例各一（G0 协议 §4 要求，开跑前必须通过）
import { describe, expect, it } from 'vitest'
import { VirtualFS } from '../../../packages/runner/src/virtual-fs.ts'
import type { EpisodeOutcome } from '../env/checker-types.ts'
import { checkers } from './index.ts'

function outcome(files: Record<string, string>, finalAnswer = ''): EpisodeOutcome {
  return { fs: new VirtualFS(files), finalAnswer, toolCalls: 1, toolErrors: 0 }
}

const cases: Array<[string, EpisodeOutcome, EpisodeOutcome]> = [
  ['g0-tool-01', outcome({ 'result.txt': '1500' }), outcome({ 'result.txt': '1400' })],
  ['g0-tool-02', outcome({ 'coat.txt': 'yes' }), outcome({ 'coat.txt': 'no' })],
  ['g0-tool-03', outcome({}, 'order_id 是 ORD-2026-0042'), outcome({}, '不知道')],
  ['g0-tool-04', outcome({}, '37.0'), outcome({}, '36.5')],
  ['g0-reas-01', outcome({}, '上海，差值 12350000'), outcome({}, '杭州，差值 100')],
  ['g0-reas-02', outcome({}, 'yes'), outcome({}, 'no')],
  ['g0-reas-03', outcome({}, '广州'), outcome({}, '北京')],
  ['g0-reas-04', outcome({ 'result.txt': '17' }), outcome({ 'result.txt': '12' })],
  ['g0-code-01', outcome({ 'solution.js': 'function twoSum(nums,target){for(let i=0;i<nums.length;i++)for(let j=i+1;j<nums.length;j++)if(nums[i]+nums[j]===target)return[i,j];return[]}' }), outcome({ 'solution.js': 'function twoSum(){return[9,9]}' })],
  ['g0-code-02', outcome({ 'solution.js': "function isPalindrome(s){return s===s.split('').reverse().join('')}" }), outcome({ 'solution.js': 'function isPalindrome(){return false}' })],
  ['g0-code-03', outcome({ 'solution.js': 'function bubbleSort(arr){const a=arr.slice();for(let i=0;i<a.length-1;i++)for(let j=0;j<a.length-1-i;j++)if(a[j]>a[j+1]){const t=a[j];a[j]=a[j+1];a[j+1]=t}return a}' }), outcome({ 'solution.js': 'function bubbleSort(arr){return arr}' })],
  ['g0-code-04', outcome({ 'solution.js': 'function parseCsvLine(line){const out=[];let cur="",q=false;for(const ch of line){if(q){if(ch===\'"\')q=false;else cur+=ch}else if(ch===\'"\')q=true;else if(ch===\',\'){out.push(cur);cur=""}else cur+=ch}out.push(cur);return out}' }), outcome({ 'solution.js': 'function parseCsvLine(line){return line.split(",")}' })],
]

describe('G0 checkers positive/negative self-test', () => {
  for (const [id, positive, negative] of cases) {
    it(`${id} accepts positive`, () => expect(checkers[id](positive).pass).toBe(true))
    it(`${id} rejects negative`, () => expect(checkers[id](negative).pass).toBe(false))
  }
})

// M3 偏离单 DEV-01：锁定「语义等价匹配」的新行为（冗长但正确的答案应通过；实质错误仍应失败）。
describe('DEV-01 健壮匹配回归', () => {
  it('g0-reas-02：冗长的 yes 结论通过（真实 G0 假象样本）', () => {
    expect(checkers['g0-reas-02'](outcome({}, '**结论：yes**\n\n计算过程（客户 C001 的全部订单）：\n- 300、450、300 元\n- 总额 1050 元 ≥ 1000 元')).pass).toBe(true)
    expect(checkers['g0-reas-02'](outcome({}, '订单金额：300、450、300，总额 = 1050 元 ≥ 1000 元。\n\n**yes**')).pass).toBe(true)
  })

  it('g0-reas-02：明确判否仍失败', () => {
    expect(checkers['g0-reas-02'](outcome({}, '**结论：no**\n\n总额 1050 元，但阈值判定为 no')).pass).toBe(false)
    expect(checkers['g0-reas-02'](outcome({}, '无法确定')).pass).toBe(false)
  })

  it('g0-tool-04：带单位的答案通过，错误数值仍失败', () => {
    expect(checkers['g0-tool-04'](outcome({}, '**37.0** 摄氏度')).pass).toBe(true)
    expect(checkers['g0-tool-04'](outcome({}, '98.6 华氏等于 37.0 摄氏度')).pass).toBe(true)
    expect(checkers['g0-tool-04'](outcome({}, '36.5')).pass).toBe(false)
  })

  it('g0-reas-01：markdown 包裹的城市名与数值仍命中', () => {
    expect(checkers['g0-reas-01'](outcome({}, '人口较多的是 **上海**，差值 **12,350,000**')).pass).toBe(true)
  })

  it('g0-code-01：CommonJS 导出写法通过（DEV-01 垫片）', () => {
    const code = 'module.exports = function(nums,target){for(let i=0;i<nums.length;i++)for(let j=i+1;j<nums.length;j++)if(nums[i]+nums[j]===target)return[i,j];return[]};'
    expect(checkers['g0-code-01'](outcome({ 'solution.js': code })).pass).toBe(true)
  })

  it('g0-code-01：CommonJS 导出但语义错误仍失败', () => {
    const code = 'module.exports = function(){return[9,9]};'
    expect(checkers['g0-code-01'](outcome({ 'solution.js': code })).pass).toBe(false)
  })
})