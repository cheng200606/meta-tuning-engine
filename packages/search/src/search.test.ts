// P1 验收：halving 淘汰/并列/预算记账、随机对照等预算、奖励接线（docs/iteration-plan.md P1）。
import { describe, expect, it } from 'vitest'
import { configId } from '@meta-tuning/action-space'
import {
  equalBudgetRandom,
  mulberry32,
  successiveHalving,
  type EpisodeMetrics,
  type EpisodeRunner,
  type HalvingSpec,
} from './halving.js'
import { minMaxNormalizer, reward } from './index.js'

const cfg = (style: 'concise' | 'step_by_step', parallel: number): Parameters<typeof configId>[0] => ({
  prompt_style: style, max_parallel_tool_calls: parallel, reasoning_effort: 'off',
})

const CONFIGS = [cfg('concise', 1), cfg('concise', 3), cfg('step_by_step', 1), cfg('step_by_step', 3)]
const tasks = (ids: string[]) => ids.map((id) => ({ id }))

/** 表驱动假执行器：真实值来自 truth 表（缺省全失败），记录每配置调用次数。 */
function fakeRunner(truth: Record<string, EpisodeMetrics>): { runner: EpisodeRunner; calls: Record<string, number> } {
  const calls: Record<string, number> = {}
  const runner: EpisodeRunner = async (config, taskId, seed) => {
    const cid = configId(config)
    const key = `${cid}|${taskId}|${seed}`
    calls[cid] = (calls[cid] ?? 0) + 1
    return truth[key] ?? { success: false, tool_accuracy: 0, steps: 3, cost: 100 }
  }
  return { runner, calls }
}

const m = (success: boolean, steps = 3): EpisodeMetrics => ({ success, tool_accuracy: success ? 1 : 0.5, steps, cost: steps * 100 })

describe('minMaxNormalizer', () => {
  it('归一化到 0..1，常量列恒 0', () => {
    const n = minMaxNormalizer([1, 2, 3])
    expect(n(1)).toBe(0)
    expect(n(3)).toBe(1)
    expect(n(2)).toBe(0.5)
    expect(minMaxNormalizer([5, 5])(5)).toBe(0)
    expect(minMaxNormalizer([])(5)).toBe(0)
  })
})

describe('reward', () => {
  it('按权重组合，正负项方向正确', () => {
    const good = reward({ success_rate: 1, tool_accuracy: 1, norm_steps: 0, norm_cost: 0 })
    const bad = reward({ success_rate: 0, tool_accuracy: 0, norm_steps: 1, norm_cost: 1 })
    expect(good).toBeCloseTo(0.8, 10)
    expect(bad).toBeCloseTo(-0.2, 10) // 全失败 + 最差步数/成本 = 0.2 惩罚
    expect(good > bad).toBe(true)
  })
})

describe('successiveHalving', () => {
  const spec = (runner: EpisodeRunner, keep: number, margin = 0.05): HalvingSpec => ({
    baseId: 'deepseek-v3',
    configs: CONFIGS,
    rounds: [
      { keep, tasks: tasks(['t1', 't2']), seeds: [0] },
      { keep: 1, tasks: tasks(['t1', 't2']), seeds: [0, 1] },
    ],
    margin,
    runEpisode: runner,
  })

  it('淘汰最差配置，冠军存活', async () => {
    const truth: Record<string, EpisodeMetrics> = {}
    for (const c of CONFIGS) {
      const cid = configId(c)
      // 可区分分数：冠军全胜且步数少；次优全胜但步数多；其余全败
      const rank = cid === configId(cfg('step_by_step', 3)) ? 0 : cid === configId(cfg('step_by_step', 1)) ? 1 : 2
      for (const t of ['t1', 't2']) for (const s of [0, 1]) {
        truth[`${cid}|${t}|${s}`] = rank === 0 ? m(true, 2) : rank === 1 ? m(true, 8) : m(false, 4)
      }
    }
    const { runner } = fakeRunner(truth)
    const out = await successiveHalving(spec(runner, 2))
    expect(out.best_config_id).toBe(configId(cfg('step_by_step', 3)))
    expect(out.survivors).toEqual([configId(cfg('step_by_step', 3))])
    expect(out.episodes).toBe(4 * 2 * 1 + 2 * 2 * 2) // 8 + 8
  })

  it('得分差 < 裕量时并列保留（幸存者可多于 keep）', async () => {
    const truth: Record<string, EpisodeMetrics> = {}
    for (const c of CONFIGS) {
      const cid = configId(c)
      // 全部同分：round1 keep=1 都应因 margin 全员保留；末轮冠军确定性取一
      for (const t of ['t1', 't2']) for (const s of [0, 1]) truth[`${cid}|${t}|${s}`] = m(true)
    }
    const { runner } = fakeRunner(truth)
    const out = await successiveHalving(spec(runner, 1, 0.05))
    expect(out.roundLog[0].kept.length).toBe(4)
    expect(out.survivors.length).toBe(1) // 末轮冠军
  })

  it('末轮取冠军无裕量并列', async () => {
    const truth: Record<string, EpisodeMetrics> = {}
    const a = configId(cfg('concise', 1)), b = configId(cfg('concise', 3))
    for (const c of CONFIGS) {
      const cid = configId(c)
      for (const t of ['t1', 't2']) for (const s of [0, 1]) {
        truth[`${cid}|${t}|${s}`] = m(cid === a || cid === b) // 决赛前两名并列
      }
    }
    const { runner } = fakeRunner(truth)
    const out = await successiveHalving(spec(runner, 2, 0)) // margin=0
    expect(out.survivors.length).toBe(1)
    expect([a, b]).toContain(out.best_config_id) // 字典序平局打破
  })

  it('roundLog 记录每轮评估与预算', async () => {
    const truth: Record<string, EpisodeMetrics> = {}
    for (const c of CONFIGS) {
      const cid = configId(c)
      const rank = cid === configId(cfg('step_by_step', 3)) ? 0 : cid === configId(cfg('step_by_step', 1)) ? 1 : 2
      for (const t of ['t1', 't2']) for (const s of [0, 1]) {
        truth[`${cid}|${t}|${s}`] = rank === 0 ? m(true, 2) : rank === 1 ? m(true, 8) : m(false, 4)
      }
    }
    const { runner } = fakeRunner(truth)
    const out = await successiveHalving(spec(runner, 2))
    expect(out.roundLog).toHaveLength(2)
    expect(out.roundLog[0].evaluated.length).toBe(4)
    expect(out.roundLog[0].episodes).toBe(8)
    expect(out.roundLog[0].kept.length).toBe(2)
    expect(out.roundLog[1].episodes).toBe(8)
    expect(out.survivors.length).toBe(1)
    expect(Object.keys(out.scores).length).toBe(4)
  })

  it('score_round 标注每个配置的最后评估轮次，scores 与该轮 cohort 分数一致', async () => {
    const truth: Record<string, EpisodeMetrics> = {}
    // 4 个配置分数严格可区分（避免平局并列保留），使第 0 轮确定淘汰 2 个
    for (const [i, c] of CONFIGS.entries()) {
      const cid = configId(c)
      const steps = 4 - i
      for (const t of ['t1', 't2']) for (const s of [0, 1]) truth[`${cid}|${t}|${s}`] = m(true, steps)
    }
    const out = await successiveHalving(spec(fakeRunner(truth).runner, 2, 0))
    expect(out.score_round[out.best_config_id]).toBe(1)
    const eliminated = Object.keys(out.score_round).filter((cid) => out.score_round[cid] === 0)
    expect(eliminated).toHaveLength(2) // 只出现在第 0 轮的配置，分数来源轮次必须为 0
    expect(out.scores[out.best_config_id]).toBeCloseTo(out.roundLog[1].scores[out.best_config_id], 10)
  })
})

describe('equalBudgetRandom', () => {
  it('预算精确等于 halving 实际消耗，采样记账无遗漏', async () => {
    const truth: Record<string, EpisodeMetrics> = {}
    for (const c of CONFIGS) {
      const cid = configId(c)
      // 与淘汰用例相同的可区分分数（避免全败并列触发裕量保留，预算才可预测）
      const rank = cid === configId(cfg('step_by_step', 3)) ? 0 : cid === configId(cfg('step_by_step', 1)) ? 1 : 2
      for (const t of ['t1', 't2']) for (const s of [0, 1]) {
        truth[`${cid}|${t}|${s}`] = rank === 0 ? m(true, 2) : rank === 1 ? m(true, 8) : m(false, 4)
      }
    }
    const out = await successiveHalving({
      baseId: 'deepseek-v3', configs: CONFIGS, runEpisode: fakeRunner(truth).runner,
      rounds: [
        { keep: 2, tasks: tasks(['t1', 't2']), seeds: [0] },
        { keep: 1, tasks: tasks(['t1', 't2']), seeds: [0, 1] },
      ],
    })
    const rand = await equalBudgetRandom({
      baseId: 'deepseek-v3', configs: CONFIGS, runEpisode: fakeRunner(truth).runner,
      budget: out.episodes, tasks: tasks(['t1', 't2']), seeds: [0, 1], rng: mulberry32(42),
    })
    expect(rand.episodes).toBe(out.episodes)
    const total = Object.values(rand.samples).reduce((s, x) => s + x, 0)
    expect(total).toBe(out.episodes)
    expect(rand.best_config_id).toBe(configId(cfg('step_by_step', 3)))
  })

  it('同种子可复现', async () => {
    const truth: Record<string, EpisodeMetrics> = {}
    for (const c of CONFIGS) {
      const cid = configId(c)
      const win = cid === configId(cfg('concise', 3))
      for (const t of ['t1', 't2']) truth[`${cid}|${t}|0`] = m(win)
    }
    const r1 = await equalBudgetRandom({ baseId: 'x', configs: CONFIGS, runEpisode: fakeRunner(truth).runner, budget: 20, tasks: tasks(['t1', 't2']), seeds: [0], rng: mulberry32(7) })
    const r2 = await equalBudgetRandom({ baseId: 'x', configs: CONFIGS, runEpisode: fakeRunner(truth).runner, budget: 20, tasks: tasks(['t1', 't2']), seeds: [0], rng: mulberry32(7) })
    expect(r2.best_config_id).toBe(r1.best_config_id)
    expect(r2.samples).toEqual(r1.samples)
  })

  it('空配置与空轮次抛错', async () => {
    await expect(successiveHalving({ baseId: 'x', configs: [], rounds: [{ keep: 1, tasks: tasks(['t1']), seeds: [0] }], runEpisode: fakeRunner({}).runner })).rejects.toThrow('configs empty')
    await expect(successiveHalving({ baseId: 'x', configs: CONFIGS, rounds: [], runEpisode: fakeRunner({}).runner })).rejects.toThrow('rounds empty')
  })

  it('keep 大于幸存者时全部保留', async () => {
    const truth: Record<string, EpisodeMetrics> = {}
    for (const c of CONFIGS) {
      const cid = configId(c)
      for (const t of ['t1', 't2']) truth[`${cid}|${t}|0`] = m(cid === configId(cfg('step_by_step', 3)))
    }
    const { runner } = fakeRunner(truth)
    const out = await successiveHalving({
      baseId: 'x', configs: CONFIGS, runEpisode: runner,
      rounds: [{ keep: 10, tasks: tasks(['t1', 't2']), seeds: [0] }],
    })
    expect(out.roundLog[0].kept.length).toBe(4)
    expect(out.best_config_id).toBe(configId(cfg('step_by_step', 3)))
  })

  it('margin 缺省 0.05：与淘汰线差 0.04 的并列保留、差 0.173 的淘汰', async () => {
    // steps [2, 2.2, 2.4, 5] → cohort 内 norm 间距 0.067/0.067/0.867，score 间距 0.013/0.013/0.173
    const truth: Record<string, EpisodeMetrics> = {}
    const stepsByRank = [2, 2.2, 2.4, 5]
    for (const [i, c] of CONFIGS.entries()) {
      const cid = configId(c)
      for (const t of ['t1', 't2']) truth[`${cid}|${t}|0`] = m(true, stepsByRank[i])
    }
    const { runner } = fakeRunner(truth)
    const out = await successiveHalving({
      baseId: 'x', configs: CONFIGS, runEpisode: runner,
      rounds: [{ keep: 2, tasks: tasks(['t1', 't2']), seeds: [0] }, { keep: 1, tasks: tasks(['t1', 't2']), seeds: [0] }],
    })
    // keep=2 淘汰线=第 2 名；第 3 名与其分差 0.013 < 0.05 → 并列保留（3 个）；第 4 名差 0.173 → 淘汰
    expect(out.roundLog[0].kept.length).toBe(3)
    expect(out.best_config_id).toBe(configId(CONFIGS[0]))
  })

  it('equalBudgetRandom 预算为 0 时返回字典序首个配置，且全部标记为未评估', async () => {
    const rand = await equalBudgetRandom({
      baseId: 'x', configs: CONFIGS, runEpisode: fakeRunner({}).runner,
      budget: 0, tasks: tasks(['t1']), seeds: [0], rng: mulberry32(1),
    })
    expect(rand.episodes).toBe(0)
    expect(rand.best_config_id).toBe(configId(CONFIGS[0]))
    expect(Object.keys(rand.scores)).toHaveLength(0)
    expect(rand.unevaluated).toHaveLength(CONFIGS.length)
  })

  it('未采样配置不参与择优：观测为负分时不得凭空以 0 分胜出', async () => {
    const configs = CONFIGS.slice(0, 2)
    let n = 0
    const runner: EpisodeRunner = async () => {
      n += 1
      const high = n % 2 === 0
      return { success: false, tool_accuracy: 0, steps: high ? 10 : 1, cost: high ? 1000 : 100 }
    }
    const rand = await equalBudgetRandom({
      baseId: 'x', configs, runEpisode: runner,
      budget: 4, tasks: tasks(['t1']), seeds: [0], rng: () => 0, // 恒定采样第 0 个配置
    })
    expect(Object.keys(rand.scores)).toEqual([configId(configs[0])])
    expect(rand.scores[configId(configs[0])]).toBeLessThan(0)
    expect(rand.unevaluated).toEqual([configId(configs[1])])
    expect(rand.best_config_id).toBe(configId(configs[0]))
  })
})
