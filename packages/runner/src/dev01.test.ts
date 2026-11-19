// M3 偏离单 DEV-01 的单测：答案归一化 + CommonJS 垫片。
// 覆盖真实 G0 失败样本里的措辞形态，确保修复确实能改判该批假象。
import { describe, expect, it } from 'vitest'
import { answerHasNumber, canonicalNumbers, canonicalYesNo, normalizeAnswer } from './answer-normalize.ts'
import { runJsAssertions } from './run-js.ts'

describe('normalizeAnswer', () => {
  it('剥离 markdown 强调与行内代码', () => {
    expect(normalizeAnswer('**结论：yes**')).toBe('结论:yes')
    expect(normalizeAnswer('`coat.txt` 已写入')).toBe('coat.txt 已写入')
    expect(normalizeAnswer('```js\nconst a = 1\n```')).toBe('const a = 1')
  })

  it('全角转半角、收敛空白', () => {
    expect(normalizeAnswer('总额　＝　１０５０')).toBe('总额 = 1050')
  })

  it('去除千分位逗号', () => {
    expect(normalizeAnswer('人口 24,870,000')).toBe('人口 24870000')
  })
})

describe('canonicalYesNo', () => {
  it('识别真实 G0 样本的冗长结论（判定器修复的目标）', () => {
    expect(canonicalYesNo('**结论：yes**\n\n计算过程（客户 C001 的全部订单）：\n- 300、450、300')).toBe('yes')
    expect(canonicalYesNo('订单金额：300、450、300，总额 = 1050 元 ≥ 1000 元。\n\n**yes**')).toBe('yes')
    expect(canonicalYesNo('**客户 C001 的全部订单金额为 300、450、300 元，总额 = 1050 元，达到 1000 元（含）的门槛，因此回答 yes。**')).toBe('yes')
    expect(canonicalYesNo('客户 C001 的订单金额为 300、450、300 元，总额 1050 元 ≥ 1000 元。\n\n**yes**')).toBe('yes')
  })

  it('取最后一个判定词元（结论在末尾）', () => {
    expect(canonicalYesNo('因为 1050 ≥ 1000，所以答案是 yes')).toBe('yes')
    expect(canonicalYesNo('because 1050 >= 1000, the answer is no')).toBe('no')
  })

  it('排除中文固定搭配（是否/不是/否则）', () => {
    expect(canonicalYesNo('这是否满足条件，需要更多数据')).toBeNull()
    expect(canonicalYesNo('不是所有订单都超过阈值')).toBeNull()
  })

  it('无明确判定返回 null（判失败，不放水）', () => {
    expect(canonicalYesNo('无法确定')).toBeNull()
    expect(canonicalYesNo('')).toBeNull()
    expect(canonicalYesNo('nothing relevant here')).toBeNull()
  })
})

describe('canonicalNumbers / answerHasNumber', () => {
  it('抽取数字并支持华氏→摄氏场景', () => {
    expect(canonicalNumbers('98.6 华氏等于 37.0 摄氏度')).toEqual([98.6, 37])
    expect(answerHasNumber('98.6 华氏等于 37.0 摄氏度', 37)).toBe(true)
    expect(answerHasNumber('答案是 12', 37)).toBe(false)
  })
})

describe('runJsAssertions — CommonJS 垫片', () => {
  const assertions = ['twoSum([2,7,11,15],9).sort().join(",") === "0,1"']

  it('支持 module.exports = function 命名导出', () => {
    const code = 'function twoSum(nums, target){const m=new Map();nums.forEach((n,i)=>m.set(n,i));for(let i=0;i<nums.length;i++){const c=target-nums[i];if(m.has(c))return [m.get(c),i];}return []}\nmodule.exports = twoSum;'
    expect(runJsAssertions(code, assertions).pass).toBe(true)
  })

  it('支持 module.exports = 匿名函数（按断言名绑定）', () => {
    const code = 'module.exports = function(nums, target){for(let i=0;i<nums.length;i++)for(let j=i+1;j<nums.length;j++)if(nums[i]+nums[j]===target)return [i,j];return []};'
    expect(runJsAssertions(code, assertions).pass).toBe(true)
  })

  it('支持 module.exports = { fn } 与 exports.fn =', () => {
    const obj = 'module.exports = { twoSum: function(nums,target){for(let i=0;i<nums.length;i++)for(let j=i+1;j<nums.length;j++)if(nums[i]+nums[j]===target)return [i,j];return []} };'
    expect(runJsAssertions(obj, assertions).pass).toBe(true)
    const exp = 'exports.twoSum = function(nums,target){for(let i=0;i<nums.length;i++)for(let j=i+1;j<nums.length;j++)if(nums[i]+nums[j]===target)return [i,j];return []};'
    expect(runJsAssertions(exp, assertions).pass).toBe(true)
  })

  it('保留原有行为：纯函数声明直接可用', () => {
    const code = 'function twoSum(nums, target){for(let i=0;i<nums.length;i++)for(let j=i+1;j<nums.length;j++)if(nums[i]+nums[j]===target)return [i,j];return []}'
    expect(runJsAssertions(code, assertions).pass).toBe(true)
  })

  it('语义错误仍判失败（垫片不放水）', () => {
    const code = 'module.exports = function(nums, target){return [0,0]};'
    const r = runJsAssertions(code, assertions)
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('assertions failed')
  })

  it('语法错误仍报 vm error', () => {
    const r = runJsAssertions('module.exports = function(', assertions)
    expect(r.pass).toBe(false)
    expect(r.reason).toContain('vm error')
  })
})
