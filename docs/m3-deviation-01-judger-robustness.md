# 偏离单 DEV-01：判定器健壮化 + run_js CommonJS 垫片

| 项 | 值 |
|---|---|
| 状态 | **待组长批准**（代码已实现并通过单测，重跑需预算批准） |
| 提出日期 | 2026-11-19 |
| 触发 | G0 测量效度审计（docs/g0-measurement-audit.md） |
| 协议依据 | docs/g0-protocol.md §8（偏离流程：书面记录 → 组长批准 → 版本递增 → 受影响数据作废重跑） |
| 预算影响 | 重跑 648 episode ≈ ¥51（上界单价）；诊断跑（仅受影响 3 任务，162 episode）≈ ¥13 |

## 1. 偏离原因

G0 的 C2（差异化前提，delta ≥ 0.03）**不稳健**。审计把 648 集失败分为「与配置能力无关的测量假象」与「实质失败」后重算：

| 口径 | gap(deepseek) | gap(qwen) | gap(glm) | delta | C1 | C2 |
|---|---|---|---|---|---|---|
| S0 原样 | 0.250 | 0.167 | 0.167 | 0.0556 | ✅ | ✅ |
| S1 仅判定器健壮化 | 0.250 | 0.167 | 0.083 | 0.0278 | ✅ | ❌ |
| S2 判定器 + CommonJS 垫片（上界） | 0.125 | 0.167 | 0.000 | 0.0000 | ✅ | ❌ |

两类假象的机制：

1. **格式假象（18 集）**：`g0-reas-02` 的判定要求 `finalAnswer.trim().toLowerCase() === 'yes'`，模型答「**结论：yes**」「总额 1050 元 ≥ 1000 元。**yes**」即判失败。该假象与 prompt_style 强相关（回答越冗长越易触发）→ 直接伪造「配置敏感性」。
2. **环境假象（31 集）**：模型按 Node 习惯写 `module.exports = function ...`，node:vm 沙箱无 `module` 全局 → `ReferenceError: module is not defined`。同样与 prompt_style 相关（glm 的 concise 配置 artifact 率 0.00，step_by_step 配置 0.13–0.17）。

假象率在配置间的分布（648 集实测）：

| 基座 | artifact 率区间 | 解读 |
|---|---|---|
| qwen3-8b | 全部 9 个配置 **0.00** | 其 gap 0.167 是**干净的真实配置敏感性** |
| deepseek-v3 | 0.08 – 0.25（随 prompt_style 反向） | gap 部分为真（修后 0.125） |
| glm-4.5-air | concise 0.00 / step_by_step 0.13–0.17 | 其「偏好 concise」**几乎全是 artifact 梯度**（修后 gap 0.000） |

## 2. 变更清单（逐文件，可审计）

| 文件 | 变更 | 类型 |
|---|---|---|
| `packages/runner/src/answer-normalize.ts` | **新增**：答案归一化（剥离 markdown/代码围栏、全角→半角、去千分位、收敛空白）+ yes/no 判定词元抽取 + 数值抽取 | 新模块 |
| `packages/runner/src/run-js.ts` | **改**：三阶段执行（垫片 → 模型代码 → 导出绑定 → 断言）；支持 `module.exports = fn`（命名/匿名）、`module.exports = { fn }`、`exports.fn =`；语义错误的导出仍判失败 | 任务环境变更 |
| `tasks/g0/env/checker-types.ts` | **改**：`answerIncludes` 归一化；新增 `answerIncludesAny` / `answerYesNo` / `answerNumber` | 判定器变更 |
| `tasks/g0/checks/index.ts` | **改**：`g0-reas-02` 用 `answerYesNo`；`g0-tool-04` 用 `answerNumber`；`g0-reas-01` 用 `answerIncludesAny` | 判定器变更 |
| `tasks/test/checks/index.ts` | **改**：本地严格 `numAnswer`/`yesNo` 换成共享健壮断言（任务定义与 expected 不变，manifest sha256 不变） | 判定器变更（实现层） |
| `packages/runner/src/index.ts` | **改**：EpisodeRecord 增字段 `final_answer`（模型最终回答原文），便于审计直接复核判定 | schema 追加字段 |
| `packages/runner/src/dev01.test.ts` | **新增**：14 个单测（归一化 + 垫片 + 真实 G0 样本措辞） | 测试 |
| `tasks/g0/checks/selftest.test.ts` | **改**：新增 6 个 DEV-01 回归断言（冗长答案通过、实质错误仍失败、CommonJS 导出通过/失败） | 测试 |

**不改动**：`tasks/g0/tasks.manifest.json`（sha256 `43059cb4…1004` 不变）、`tasks/dev/manifest.json`、`tasks/test/manifest.json`（sha256 `bcafdca1…44ee` 不变）、`configs/**`、`policies.json`、`docs/g0-protocol.md`、所有任务指令与 expected 语义。

## 3. 预期影响（基于原轨迹重算，非重跑结果）

- C1 预计仍通过（deepseek 0.125–0.250、qwen 0.167 均 ≥ 0.10；glm 可能降至 0.000，仍满足「≥2 个基座」）。
- **C2 预计不通过**：点估计落在 0.000–0.028，低于阈值 0.03。
- **我们不是为了挽救结论而修复，而是为了知道真相。** 若重跑后 C2 仍不成立，项目定位应转为「配置敏感性成立（qwen/deepseek），跨基座差异化不成立」——这会改变论文主张，需重新评估创新声明。

## 4. 重测方案（待批准）

| 阶段 | 内容 | 规模 | 费用 | 目的 |
|---|---|---|---|---|
| A | 诊断跑：仅 g0-reas-02 / g0-code-01 / g0-code-02（受两类假象影响的任务）× 9 配置 × 3 基座 × 2 seed | 162 episode | ≈¥13 | 验证修复在真实模型上确实生效（假象率下降、代码任务不再 vm error） |
| B | 全量重跑：3 × 9 × 12 × 2 | 648 episode | ≈¥51 | 得到唯一可用于判据计算的干净数据集（原 G0 数据按协议 §8 作废） |

- **执行纪律**：跑批前在 `docs/g0-protocol.md` 记版本递增（v1.1-已冻结）与偏离编号；产物写入新目录 `experiments/<date>-m1-g0-full-v2/`，**不覆盖** v1.0 产物（v1.0 保留为审计证据）；重跑后由独立脚本重算 C1/C2 并与本偏离单的预期区间对照。
- **不做的事**：不重跑时也**不得**把 S1/S2 的重算值当作正式判据结果（它们基于原轨迹，只是敏感性分析）。

## 5. 风险与副作用

1. **判定变宽松可能引入假阳性**：`answerNumber` 采用「答案中任一数字等于期望值即命中」，理论上「98.6 华氏 = 37 摄氏度」与「答案不是 37」都会命中。缓解：仅用于单一数值型任务（g0-tool-04），并在报告中说明。
2. **`canonicalYesNo` 取最后一个判定词元**：若模型同时写出两个候选（如「yes 而非 no」），可能取错。实测 G0 的 18 条样本**无一条含多个判定词元**（歧义样本 0），风险已被数据排除。
3. **垫片可能掩盖真实错误**：`module.exports` 绑定后，模型写的函数若语义错误仍会断言失败（已由单测锁定）；垫片只解决「找不到符号」，不改变断言表达式。
4. **test 集判定器实现变更**：test 集的 expected 语义与 manifest sha256 均不变，属实现层修复；已在 tasks/test/README.md 冻结记录中追加说明。

## 6. 验收标准

1. `pnpm build && pnpm typecheck && pnpm test` 全绿（当前 182/182）；
2. 阶段 A 后：g0-reas-02 的严格匹配失败率显著下降、g0-code-01/02 的 `module is not defined` 归零；
3. 阶段 B 后：新数据集的 C1/C2 由独立脚本重算，与本单第 3 节预期区间对照，差异需在报告中解释；
4. 冻结资产 sha256 全部不变（g0 manifest `43059cb4…1004`、test manifest `bcafdca1…44ee`）；
5. 全程留痕：偏离单、批准记录、两轮产物、审计脚本均在库内。

## 7. 复现

```bash
node --import tsx/esm analysis/g0_artifact_sensitivity.ts   # 三档敏感性（原轨迹重算）
node --import tsx/esm analysis/dev01_validate.ts            # 修复对真实假象样本的改判验证
```
