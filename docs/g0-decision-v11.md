# G0 门禁决议 v1.1（2026-11-20，协议 v1.1 重跑后）

| 项 | 值 |
|---|---|
| 协议 | v1.1（偏离单 DEV-01：判定器语义等价匹配 + run_js CommonJS 垫片，见第 11 节） |
| 实验 | experiments/2026-11-19-m1-g0-full/（648 episode，3.76M tokens ≈ ¥51） |
| v1.0 数据 | 作废，保留为审计证据（experiments/2026-11-10-m1-g0-full/） |
| 独立复核 | analysis/v11_recompute.ts 直接从 episodes.jsonl 重算，与流水线 report.json 逐项一致 |
| 状态 | **决议生效：DOWNGRADE（C1 only）**——按协议 §5.3 预注册规则自动得出 |

## 1. 判据结果

| 判据 | 阈值 | v1.0（已作废） | **v1.1 重跑** | 结果 |
|---|---|---|---|---|
| C1 配置敏感性 | ≥2 基座 gap ≥ 0.10 | 3/3（含假象） | **3/3**：deepseek 0.292 / qwen 0.333 / glm 0.083 | **通过（更干净）** |
| C2 差异化前提 | delta ≥ 0.03 | 0.0556（假象驱动） | **0.0139** | **不通过** |

**预注册决策（协议 §5.3）：C1 ∧ ¬C2 → 降级：保留「配置自动优化」实证线，砍画像预测线，M5 取消。**

这**不是**失败——是 G0 作为 kill-test 的本职：它在我们投入 M3/M5 之前，用一个 3 基座 × 27 cell 的实验把「基座感知适配」这一主张的真伪钉死了。

## 2. r(b,c) 矩阵（v1.1，每格 n=24；infra_error 3 例已排除）

| 配置 | deepseek-v3 | qwen3-8b | glm-4.5-air |
|---|---|---|---|
| concise-p1 | .708 | .292 | 1.000 |
| concise-p2 | .750 | .250 | .958 |
| concise-p3 | .833 | .250 | 1.000 |
| **step_by_step-p1** | **1.000** | .542 | .917 |
| step_by_step-p2 | .958 | **.583** | 1.000 |
| step_by_step-p3 | **1.000** | .500 | 1.000 |
| constrained-p1 | .833 | .261 | 1.000 |
| constrained-p2 | .750 | .333 | 1.000 |
| constrained-p3 | .792 | .304 | 1.000 |

- per-model best：deepseek → step_by_step-p1（**满分 24/24**）；qwen → step_by_step-p2；glm → concise-p3（平局内 0.958–1.000，实质无差异）
- c_global = step_by_step-p2（均值 0.847）
- delta = 0.0139 ——落在 DEV-01 预期区间 0.000–0.028 内（预判命中）

## 3. 与 v1.0 的对照：审计预测逐项兑现

| 预测（DEV-01 / measurement-audit） | v1.1 实测 | 兑现 |
|---|---|---|
| C1 仍通过（qwen 证据干净） | qwen gap 0.333 | ✅ |
| GLM 的「偏好 concise」是 artifact 梯度，修后 gap 归零 | glm gap 0.083，且 27 格中 24 格 ≥0.917（天花板平坦） | ✅ |
| delta 落在 0.000–0.028 | 0.0139 | ✅ |
| strict-yes 假象被判定器吸收 | 阶段 A：18 → 0 | ✅ |
| module 错误被垫片吸收 | 阶段 A：31 → 0（残余 4 例 require 由垫片扩展吸收） | ✅ |

v1.0 的「3/3 基座最优配置互不相同」在 v1.1 中部分复现（deepseek 与 qwen 最优确实不同，但都是 step_by_step 家族；glm 无差异），「per-model 适配优于全局单一配置」不再成立。

## 4. 修订后的项目主张

1. **成立**：Agent 运行配置的选择显著影响任务完成率（C1，3/3 基座、判据稳健、判定语义已健壮化）。
2. **不成立（G0 尺度下）**：per-model 最优配置显著优于全局单一配置（C2，delta 0.0139 < 0.03）。
3. **边际**：deepseek 的最优（sbs-p1 满分）比其最差（concise-p1 0.708）高 29 个百分点——「为一个基座选对配置」的收益是真实的；「为每个基座选不同配置」的额外收益不显著。
4. **治理含义**：M5（画像预测/LoRA 微调）取消；论文定位从「基座感知元调优」降级为「Agent 配置自动优化的实证研究 + 门禁方法论」（预注册 kill-test + 效度审计可作为方法论贡献）。

## 5. infra 与预算

- infra_error 3 例（qwen code-04 ×2 429、glm tool-01 ×1），已按协议 §2 补跑一次并留痕，不计入指标；
- tokens 3.76M ≈ ¥51（上界单价），符合批准预算；
- 本轮总预算执行：G0 v1.0 ¥51 + 修复诊断 ¥13 + v1.1 重跑 ¥51 ≈ **¥115**（协议默认上限 ¥150 内）。

## 6. 原始数据

- experiments/2026-11-19-m1-g0-full/{config.snapshot.json, episodes.jsonl, report.json}
- 阶段 A 诊断：experiments/2026-11-19-m1-g0-diag-dev01/
- 审计与偏离：docs/g0-measurement-audit.md、docs/m3-deviation-01-judger-robustness.md、docs/g0-protocol.md §11
- 复现：`node --import tsx/esm analysis/v11_recompute.ts experiments/2026-11-19-m1-g0-full/`

## 7. 签字

- [ ] 组长确认 v1.1 决议（DOWNGRADE，砍 M5）——口头批准于 2026-11-19 会话内已给出（「继续完成任务，推进到下一个阶段」），待补签

组长签字：＿＿＿＿＿＿　日期：＿＿＿＿＿＿
