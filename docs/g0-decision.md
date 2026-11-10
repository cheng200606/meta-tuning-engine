# G0 门禁决议（草案，待组长确认）

日期：2026-11-11
数据：experiments/2026-11-10-m1-g0-full/（648 episode + 补跑，2.79M tokens；按协议 §7 上界单价 ≈¥37，低于 §9 默认上限 ¥150）
协议：docs/g0-protocol.md v1.0-已冻结

## 判据结果

| 判据 | 阈值 | 实测 | 结论 |
|---|---|---|---|
| C1 配置敏感性 | ≥2 基座 gap ≥ 10pp | deepseek 25.0pp / qwen 33.2pp / glm 17.8pp（3/3） | ✅ |
| C2 差异化前提 | delta ≥ 3pp | **7.31pp** | ✅ |

**按冻结决策规则：C1 ∧ C2 → PASS，进入 M2（插件 + 策略库）。**

## 核心发现（论文素材）

- 三基座最优配置**互不相同**：deepseek-v3 → step_by_step-p3-roff（83.3%）；qwen3-8b → step_by_step-p2-roff（63.6%）；glm-4.5-air → concise-p1-roff（91.7%）；
- 全局最优单配置 step_by_step-p2-roff 对 GLM 明显不利（73.9% vs 其最优 91.7%，差 17.8pp）——「一套通吃」不成立，基座感知前提成立；
- 方向性规律初现：能力较强的基座（GLM）偏好简洁提示+串行，较弱基座（Qwen）依赖分步引导——待 M3 多基座验证是否系统性成立。

## 数据质量警示（必须随结果引用）

- 62 条最终 infra_error（全部为硅基流动 429 限流/网络）：qwen3-8b 56 条、glm-4.5-air 6 条、deepseek 0；
- 每格有效样本：DeepSeek 24/24 满格；GLM 20–24；**Qwen 11–24 不齐**；
- 判据计算已按协议排除 infra 行，但 Qwen 的不均衡样本可能影响其最优配置选择的可信度（step_by_step-p2 与 p1/p3 差距在噪声范围内）；
- run_js 沙箱 × CommonJS：deepseek-v3 代码类任务 24 例失败为 `vm error: ReferenceError: module is not defined`（模型习惯用 module.exports 导出）。同基座内跨配置均匀（code-01×9 / 02×13 / 04×2），压低其代码任务绝对分但不改变配置间相对排序；M3 扩任务集时评估给 run_js 加 CommonJS shim（任务环境变更，按协议 §8 走偏离流程）。

## 复核声明

判据全部量（r(b,c) 矩阵、gap(b)、c*(b)、c_global、delta、C1/C2）已从 episodes.jsonl **独立重算**，与流水线生成的 report.json 一致（差异 < 1e-9）；无重复 (base, config, task, seed) 键；每格有效数 = 24 − infra；runner/判定器测试套件 35/35 通过（2026-11-11 00:00 复跑确认）。

## 待组长决策：Qwen 缺失数据修复

- 选项 A（建议）：修复跑——仅补 Qwen 缺失格（约 56+ 个 episode），并发 1 + 请求间隔 2s，费用 <¥5；修复后重算判据，若结论不变则决议生效；
- 选项 B：接受现状——决议按当前数据生效，论文中如实报告不均衡样本与限流原因；
- 选项 C：升级硅基流动付费档后整体重跑 Qwen/GLM。

组长签字：________________　日期：________________