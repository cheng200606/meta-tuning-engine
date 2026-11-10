import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, configId, enumerateConfigs, parseConfig } from './index.js'

const both = { parallel_tool_calls: true, reasoning_effort: true }
const g0 = { parallel_tool_calls: true, reasoning_effort: false }
const neither = { parallel_tool_calls: false, reasoning_effort: false }

describe('action-space', () => {
  it('全可用时枚举 27 个配置', () => {
    expect(enumerateConfigs(both)).toHaveLength(27)
  })

  it('G0 场景（reasoning 固定 off）枚举 9 个配置', () => {
    expect(enumerateConfigs(g0)).toHaveLength(9)
  })

  it('全不支持时只剩 3 个配置', () => {
    expect(enumerateConfigs(neither)).toHaveLength(3)
  })

  it('非法输入回退默认配置并按可用性裁剪', () => {
    const config = parseConfig({ prompt_style: 'bad', max_parallel_tool_calls: 99 }, neither)
    expect(config).toEqual(DEFAULT_CONFIG)
  })

  it('合法但越界的并行数被 schema 拒绝后回退', () => {
    const config = parseConfig(
      { prompt_style: 'concise', max_parallel_tool_calls: 2, reasoning_effort: 'high' },
      neither,
    )
    expect(config.max_parallel_tool_calls).toBe(1)
    expect(config.reasoning_effort).toBe('off')
    expect(config.prompt_style).toBe('concise')
  })

  it('configId 稳定', () => {
    expect(configId(DEFAULT_CONFIG)).toBe('step_by_step-p1-roff')
  })
})