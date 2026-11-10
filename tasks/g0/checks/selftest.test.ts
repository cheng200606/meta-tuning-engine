// 判定器自测：每任务正例/反例各一（G0 协议 §4 要求，开跑前必须通过）
import { describe, expect, it } from 'vitest'
import { VirtualFS } from '../env/virtual-fs.ts'
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