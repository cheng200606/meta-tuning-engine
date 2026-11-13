// test 保留集判定器自测：每任务正例 + 反例（含缺文件）。先自测后冻结。
import { describe, expect, it } from 'vitest'
import { VirtualFS } from '../../../packages/runner/src/virtual-fs.ts'
import { fixturesByTask } from '../env/fixtures.ts'
import { checkers } from './index.ts'

const run = (id: string, extra: Record<string, string>, finalAnswer: string): { pass: boolean; reason: string } =>
  checkers[id]({ fs: new VirtualFS({ ...fixturesByTask[id], ...extra }), finalAnswer, toolCalls: 0, toolErrors: 0 })

const goodCode: Record<string, string> = {
  'test-code-01': 'function sumRange(a,b){if(a>b)return 0;let s=0;for(let i=a;i<=b;i++)s+=i;return s}',
  'test-code-02': "function countChar(s,ch){let n=0;for(const c of s)if(c===ch)n++;return n}",
  'test-code-03': 'function minMax(ns){return [Math.min(...ns),Math.max(...ns)]}',
  'test-code-04': 'function isEven(n){return n%2===0}',
  'test-code-05': "function firstWord(s){return s.trim().split(/\\s+/)[0]}",
  'test-code-06': 'function dupCount(ns){const c={};let k=0;for(const n of ns){c[n]=(c[n]||0)+1;if(c[n]===2)k++}return k}',
  'test-code-07': "function swapCase(s){return s.split('').map(c=>c===c.toUpperCase()?c.toLowerCase():c.toUpperCase()).join('')}",
  'test-code-08': 'function lastN(ns,n){return ns.slice(-n)}',
  'test-code-09': 'function digitSum(n){return String(n).split("").reduce((a,c)=>a+Number(c),0)}',
  'test-code-10': "function padZeros(s,len){return s.length>=len?s:'0'.repeat(len-s.length)+s}",
}

// 反例：语义错误的实现（对代码任务）或错误文件内容（对文件任务）
const badCode: Record<string, string> = {
  'test-code-01': 'function sumRange(a,b){if(a>b)return 0;let s=0;for(let i=a;i<b;i++)s+=i;return s}',
  'test-code-02': "function countChar(s,ch){return s.length}",
  'test-code-03': 'function minMax(ns){return [Math.max(...ns),Math.min(...ns)]}',
  'test-code-04': 'function isEven(n){return n%2===1}',
  'test-code-05': "function firstWord(s){return s.split(/\\s+/).pop()}",
  'test-code-06': 'function dupCount(ns){return ns.length}',
  'test-code-07': "function swapCase(s){return s}",
  'test-code-08': 'function lastN(ns,n){return ns.slice(0,n)}',
  'test-code-09': 'function digitSum(n){return n}',
  'test-code-10': "function padZeros(s,len){return s}",
}

describe('test set checkers — positive', () => {
  // 非代码任务的正例：期望文件内容或期望答案
  const positive: Record<string, { files?: Record<string, string>; answer?: string }> = {
    'test-tool-01': { answer: '30' },
    'test-tool-02': { files: { 'status.txt': 'delivered' } },
    'test-tool-03': { files: { 'sh_temp.txt': '12' } },
    'test-tool-04': { answer: '42' },
    'test-tool-05': { files: { 'r50.txt': '50' } },
    'test-tool-06': { files: { 'pop.txt': '24870000' } },
    'test-tool-07': { files: { 'second_order.txt': '450' } },
    'test-tool-08': { files: { 'last.txt': 'gamma' } },
    'test-tool-09': { files: { 'six.txt': '6' } },
    'test-tool-10': { files: { 'temp_of_city.txt': '24' } },
    'test-reas-01': { answer: '19' },
    'test-reas-02': { answer: '300' },
    'test-reas-03': { answer: 'yes' },
    'test-reas-04': { files: { 'product.txt': '24' } },
    'test-reas-05': { answer: '上海' },
    'test-reas-06': { answer: 'yes' },
    'test-reas-07': { answer: '上海' },
    'test-reas-08': { files: { 'square.txt': '36' } },
    'test-reas-09': { answer: 'yes' },
    'test-reas-10': { answer: '上海' },
  }
  for (const id of Object.keys(fixturesByTask)) {
    it(`${id} 正例`, () => {
      const spec = goodCode[id] !== undefined
        ? { files: { 'solution.js': goodCode[id] }, answer: '' }
        : positive[id]
      const result = run(id, spec.files ?? {}, spec.answer ?? '')
      if (!result.pass) throw new Error(`${id} 正例失败: ${result.reason}`)
      expect(result.pass).toBe(true)
    })
  }
})

describe('test set checkers — negative', () => {
  for (const id of Object.keys(fixturesByTask)) {
    it(`${id} 反例（缺失产物）`, () => {
      const result = run(id, {}, '')
      expect(result.pass).toBe(false)
    })
    if (badCode[id] !== undefined) {
      it(`${id} 反例（错误实现）`, () => {
        expect(run(id, { 'solution.js': badCode[id] }, '').pass).toBe(false)
      })
    } else {
      it(`${id} 反例（错误内容/答案）`, () => {
        // 文件任务写入错误值；答案任务给出不含期望串的回答
        const wrongFiles: Record<string, string> = {
          'test-tool-01': {}, 'test-tool-02': { 'status.txt': 'pending' }, 'test-tool-03': { 'sh_temp.txt': '13' },
          'test-tool-04': {}, 'test-tool-05': { 'r50.txt': '49' }, 'test-tool-06': { 'pop.txt': '12520000' },
          'test-tool-07': { 'second_order.txt': '300' }, 'test-tool-08': { 'last.txt': 'beta' }, 'test-tool-09': { 'six.txt': '7' },
          'test-tool-10': { 'temp_of_city.txt': '25' }, 'test-reas-04': { 'product.txt': '9' }, 'test-reas-08': { 'square.txt': '12' },
        }
        const wrongAnswers: Record<string, string> = {
          'test-tool-01': 'pear: 12', 'test-tool-04': 'build: 43', 'test-reas-01': '18', 'test-reas-02': '450',
          'test-reas-03': 'no', 'test-reas-05': '广州', 'test-reas-06': 'no', 'test-reas-07': '浙江', 'test-reas-09': 'no',
          'test-reas-10': '北京',
        }
        const files = wrongFiles[id] ?? {}
        const answer = wrongAnswers[id] ?? '不相关回答'
        const result = run(id, files, answer)
        expect(result.pass).toBe(false)
      })
    }
  }
})
