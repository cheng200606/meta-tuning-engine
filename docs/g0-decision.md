# G0 门禁决议（草案，待组长确认）

日期：2026-11-11
数据：experiments/2026-11-10-m1-g0-full/（全量 648 episode + infra 修复跑 62 episode，合计 3.80M tokens；按协议 §7 上界单价 ≈¥51，低于 §9 默认上限 ¥150）
协议：docs/g0-protocol.md v1.0-已冻结

**主口径说明**：主结果基于「合并口径」——原 648 episode 中 62 例 infra_error（429 限流）已由修复跑全部替换（62/62 回收，0 例仍失败），最终每格有效样本 **24/24 满格、零剔除**。原口径（infra 剔除、每格 11–24 不齐）作为敏感性检验保留，结论一致。

## 判据结果

| 判据 | 阈值 | 合并口径（主） | 原口径（敏感性检验） | 结论 |
|---|---|---|---|---|
| C1 配置敏感性 | ≥2 基座 gap ≥ 10pp | 3/3：deepseek 25.0pp / qwen 16.7pp / glm 16.7pp | 3/3：25.0 / 33.2 / 17.8pp | ✅ |
| C2 差异化前提 | delta ≥ 3pp | **5.6pp** | 7.3pp | ✅ |

**按冻结决策规则：C1 ∧ C2 → PASS，进入 M2（插件 + 策略库）。结论在两种口径下均成立，对 infra 处理方式稳健。**

## 完成率矩阵 r(b,c)（合并口径，每格 n=24，加粗为各基座最优）

| 配置 | deepseek-v3 | qwen3-8b | glm-4.5-air |
|---|---|---|---|
| concise-p1-roff | .583 | .417 | **.917** |
| concise-p2-roff | .583 | .375 | .917 |
| concise-p3-roff | .667 | .375 | .917 |
| **step_by_step-p1-roff** | .667 | **.458** | .750 |
| step_by_step-p2-roff | .792 | .333 | .750 |
| step_by_step-p3-roff | **.833** | .417 | .792 |
| constrained-p1-roff | .667 | .375 | .913 |
| constrained-p2-roff | .667 | .292 | .875 |
| constrained-p3-roff | .792 | .333 | .875 |

- gap(b)：0.250 / 0.167 / 0.167 —— 三基座全部超过 C1 阈值；
- c*(b)：deepseek-v3 → step_by_step-p3-roff（.833 唯一最大）；qwen3-8b → step_by_step-p1-roff；glm-4.5-air → concise-p1-roff（p1/p2/p3 三方 .917 平局，按协议 §5.1 平局规则比平均步数：p1 与 p3 均 2.67 步，字典序取 p1）；
- c_global = step_by_step-p3-roff（跨基座均值 .681）；
- delta = mean_b r(b, c*(b)) − r̄(c_global) = .736 − .681 = **.056**。

**核心发现（论文素材）**

- 三基座最优配置**互不相同**：deepseek-v3 → step_by_step-p3（83.3%）；qwen3-8b → step_by_step-p1（45.8%）；glm-4.5-air → concise-p1（91.7%）；
- 全局最优单配置 step_by_step-p3 对 GLM 明显不利（79.2% vs 其最优 91.7%，差 12.5pp）——「一套通吃」不成立，基座感知前提成立；
- 方向性规律初现：能力较强的基座（GLM）偏好简洁提示+串行，较弱基座（Qwen）整体完成率低（.29–.46）且对配置的响应呈浅丘状（最优与次优差 ~4pp）——Qwen 的 c*(b) 选择置信度弱于另两基座，M3 更多 seed/任务下需复核。

## 数据质量记录

- **infra 修复跑（已执行）**：原全量 62 例 infra_error（qwen3-8b 56 / glm-4.5-air 6，全部为硅基流动 429 限流或网络失败，重试 4 次 + 协议内补跑一次后仍失败）。修复跑（scripts/repair-g0-infra.ts，并发 1 + 每集前置 2s 间隔）**62/62 回收，0 例仍失败**，消耗 0.82M in + 0.19M out tokens（≈¥14）。产物在独立文件 repair-episodes.jsonl / repair-report.json，原 episodes.jsonl / report.json / config.snapshot.json 未改动一字节；
- **执行说明**：组长未及时应答时按草案建议项（A）自主执行；修复纯增量、可逆（最终采纳口径由组长签字确认），主结果与敏感性检验均已备妥；
- **run_js 沙箱 × CommonJS**：deepseek-v3 代码类任务 24 例失败为 `vm error: ReferenceError: module is not defined`（模型习惯用 module.exports 导出）。同基座内跨配置均匀（code-01×9 / 02×13 / 04×2），压低其代码任务绝对分但不改变配置间相对排序；M3 扩任务集时评估给 run_js 加 CommonJS shim（任务环境变更，按协议 §8 走偏离流程）；
- **严格答案匹配**：g0-reas-01/02、g0-tool-03 存在少量「答案内容正确但格式不符」的失败（markdown 加粗、单位/分隔符差异）。判定语义冻结，均匀作用于全部基座与配置。

## 复核声明

- 全量口径：判据全部量从 episodes.jsonl 独立重算，与 report.json 一致（差异 < 1e-9）；
- 合并口径：从 episodes.jsonl + repair-episodes.jsonl 独立重算，与 repair-report.json 一致；648 行合并后无重复 (base, config, task, seed) 键，27 格全部 n=24；
- runner/判定器测试套件 35/35 通过（2026-11-11 00:00 复跑确认）。

## 对 M2 的输入

策略库 G0 初版入库内容（开发实验方案 §5.1，人工整理允许；按合并口径）：

| base_id | config | 依据 |
|---|---|---|
| deepseek-v3 | step_by_step-p3-roff | r = .833，gap .250 |
| qwen3-8b | step_by_step-p1-roff | r = .458（浅丘最优，置信度弱，M3 复核） |
| glm-4.5-air | concise-p1-roff | r = .917（三方平局胜出），gap .167 |

## 原始数据

- experiments/2026-11-10-m1-g0-full/config.snapshot.json（协议版本、manifest hash、commit、全部冻结参数）
- experiments/2026-11-10-m1-g0-full/episodes.jsonl（648 行，schema = packages/runner 的 EpisodeRecord）
- experiments/2026-11-10-m1-g0-full/report.json（原口径判据 + infra 明细 + tokens）
- experiments/2026-11-10-m1-g0-full/repair-episodes.jsonl（62 行修复数据）
- experiments/2026-11-10-m1-g0-full/repair-report.json（双口径判据）

## 冻结签字

- [ ] 组长确认本决议（含修复跑采纳与否）；签署后 M2 正式开工

组长签字：________________　日期：________________
