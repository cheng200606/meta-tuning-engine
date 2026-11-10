# G0 门禁实验协议

| 项 | 值 |
|---|---|
| 版本 | v1.0 |
| 制定日期 | 2026-11-10 |
| 状态 | **待冻结**（第 9 节签字后生效；生效前不得运行任何 G0 episode） |
| 任务清单 | tasks/g0/tasks.manifest.json |
| 清单 sha256 | `43059cb4d2e5be37dd83553bd9ecbddd0bc4dd3a0ec43944c21cc89b6fea1004` |

本协议冻结 G0 实验的全部设计参数与判据。**看到数据之后修改本协议任何条款 = 实验作废**；必要偏离走第 8 节流程。

---

## 1. 目的与假设

验证「基座感知配置适配」的两个核心前提：

- **H1 配置敏感性**：Agent 运行配置的选择显著影响任务完成率；
- **H2 差异化前提**：不同基座的最优配置不同，per-model 适配优于全局单一配置。

G0 是项目生死门：H1+H2 成立才进入 M2（插件开发）；否则按第 5.3 节降级或止损。

## 2. 冻结参数

| 参数 | 值 |
|---|---|
| 基座 | deepseek-v3、qwen3-8b、llama-3.3-70b（configs/bases.yaml；替换第三基座须走第 8 节） |
| 配置空间 | prompt_style {concise, step_by_step, constrained} × max_parallel_tool_calls {1, 2, 3}，reasoning_effort 固定 off，共 **9 个配置** |
| 任务 | manifest 中 12 个（tool×4 / reasoning×4 / code×4），指令措辞以 manifest 为准 |
| seed | {0, 1}，每「基座×配置×任务」跑 2 个 episode |
| temperature | 0（其余采样参数用 API 默认，不额外设置） |
| 步数上限 | 10 步（超限记失败，failure_reason=max_steps） |
| 环境重置 | 每 episode 独立重置虚拟文件系统与工具状态 |
| API 并发 | 上限 2；429/5xx/网络错误指数退避重试 3 次（1s/2s/4s） |
| 基础设施失败 | 重试后仍失败 → 该 episode 记 `infra_error`，不计入指标，补跑一次；补跑仍失败则记录并上报组长，**不得静默剔除** |
| 总规模 | 3 × 9 × 12 × 2 = **648 episode**（不含补跑） |
| 可用性前提 | configs/availability.yaml 全部填实测值后方可全量运行；若某基座不支持并行 tool call，其 p2/p3 配置退化为 p1 语义并在 report 中注明（该基座有效配置数相应减少，判据按有效配置计算） |

**9 个配置的 config_id**：
`concise-p1-roff` `concise-p2-roff` `concise-p3-roff` `step_by_step-p1-roff` `step_by_step-p2-roff` `step_by_step-p3-roff` `constrained-p1-roff` `constrained-p2-roff` `constrained-p3-roff`

## 3. 指标定义

- **success_rate（主指标）**：checker 断言通过记 1，否则 0。「基座×配置」完成率 = 24 次运行（12 任务 × 2 seed）的均值；
- **tool_accuracy**：1 − 工具错误调用数 / 总调用数；工具返回 error（参数非法、工具内部异常）记一次错误调用；无调用记 1.0；
- 次要指标：平均步数、prompt/completion tokens、端到端延迟、失败原因分布；
- 判定器纪律：checker 开跑前用正例/反例各一自测通过；开跑后不得修改判定标准。

## 4. 运行流程

1. **冒烟（20 episode）**：deepseek-v3 × {concise-p1-roff, step_by_step-p3-roff} × 前 5 个任务 × 2 seed。验证 runner、判定器、日志链路；实测单 episode token/延迟/费用；
2. **预算核对**：按冒烟单价外推 648 episode 总费用，超过第 9 节预算上限 → 暂停，组长决定换基座或追加预算；
3. **全量运行**：648 episode，产物按 experiments/README.md 规范落盘；
4. **计算判据**：按第 5 节公式计算 C1/C2，生成 report.json；
5. **决议**：组长依据第 5.3 节签署 docs/g0-decision.md（附原始数据链接）。

## 5. 判据与决策（实验前冻结）

### 5.1 计算定义

记 `r(b,c)` 为基座 b 在配置 c 上的完成率（24 次均值）。

- **极差** `gap(b) = max_c r(b,c) − min_c r(b,c)`（c 遍历该基座有效配置）；
- **per-model 最优** `c*(b) = argmax_c r(b,c)`；平局取平均步数更低者，再平局取 config_id 字典序较小者；
- **全局最优** `c_global = argmax_c mean_b r(b,c)`；平局规则同上（跨基座平均步数 → 字典序）；
- **差异化增益** `delta = mean_b r(b, c*(b)) − mean_b r(b, c_global)`。

### 5.2 判据

- **C1（配置敏感性）**：至少 **2 个基座**满足 `gap(b) ≥ 0.10`（10 个百分点）；
- **C2（差异化前提）**：`delta ≥ 0.03`（3 个百分点）。

### 5.3 决策规则

| 结果 | 决策 |
|---|---|
| C1 ∧ C2 | 通过，进入 M2（插件 + 策略库） |
| C1 ∧ ¬C2 | 降级：保留「配置自动优化」实证线，砍画像预测线，M5 取消 |
| ¬C1 | 止损：不写插件；转向成本/延迟适配或另选题（转向提案另立文档） |

## 6. 数据记录

- 每 episode 一行 JSONL，schema = packages/runner 的 `EpisodeRecord`；
- `config.snapshot.json` 必含：本协议版本、manifest sha256、仓库 commit、基座与模型名实际值、全部冻结参数；
- `report.json` 必含：r(b,c) 全矩阵、gap(b)、c*(b)、c_global、delta、C1/C2 布尔值、infra_error 清单、费用合计。

## 7. 预算

- 冒烟后回填：单 episode 均值 tokens = ____，全量预估费用 = ____；
- 预算上限见第 9 节签字栏；超限触发暂停评审（开发实验方案 §11）。

## 8. 偏离与冻结纪律

- 本协议生效后的任何参数变更（含换基座、改任务措辞、调阈值）必须：书面记录偏离原因 → 组长批准 → 版本号递增 → **受影响数据作废重跑**；
- 禁止事后选择性剔除数据点；infra_error 处理按第 2 节执行并全程留痕；
- 任务清单变更 = manifest sha256 变化 = 必须重新冻结。

## 9. 冻结签字

- [ ] 判据 C1/C2 与决策规则已审阅，实验前不再更改
- [ ] 任务清单 sha256 与本文件一致
- [ ] 预算上限（人民币）：________（建议按冒烟外推后填写；未填默认 ¥150）
- [ ] runner/判定器自测通过（冒烟前检查）

组长签字：_________程夏_______　日期：____________2026/11/10____

生效版本号：________（签字后由 v1.0-待冻结 改为 v1.0-已冻结）