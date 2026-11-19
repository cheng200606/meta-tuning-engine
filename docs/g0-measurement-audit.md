# G0 测量效度审计（2026-11-19）

> 触发：向导师汇报前的自审。问题——G0 的头条结论（delta=5.6pp，C2 通过）有多少来自**与配置质量无关的测量假象**？
> 复算脚本：`analysis/g0_artifact_sensitivity.mjs`（零 API，直接重算已冻结的 648 episode）。

## 1. 失败分类（合并口径，648 集）

| 类别 | 数量 | 占比 | 性质 |
|---|---|---|---|
| pass | 416 | 64.2% | — |
| content_missing（答案/文件缺关键内容） | 85 | 13.1% | 实质失败 |
| other（solution.js missing 等指令遵循失败） | 56 | 8.6% | 实质失败 |
| **format_artifact**（答案含 `yes` 但不严格等于 `yes`） | 36 | 5.6% | **测量假象** |
| **env_artifact**（`vm error: module is not defined`） | 31 | 4.8% | **测量假象** |
| max_steps | 20 | 3.1% | 实质失败 |
| format_artifact_empty（空答案） | 4 | 0.6% | 实质失败 |

## 2. 假象集中在两个任务，且与 prompt_style 强相关

| 任务 | artifact 占比 | 机制 |
|---|---|---|
| g0-reas-02 | **67%（36/54）** | 判定器要求 `finalAnswer.trim().toLowerCase() === 'yes'`；模型答「**结论：yes**」「总额 = 1050 元 ≥ 1000 元，**yes**」即判失败 |
| g0-code-01 | 30% | 模型按 CommonJS 习惯 `module.exports = ...`，node:vm 沙箱无该全局 → ReferenceError |
| g0-code-02 | 24% | 同上 |

因果链：**prompt_style → 回答冗长度 / 代码导出风格 → 判定器或沙箱的兼容性 → 完成率**。这不是「配置影响任务能力」，是「配置影响格式合规性」。

## 3. 敏感性重算（判据是否稳健）

| 口径 | gap(deepseek) | gap(qwen) | gap(glm) | delta | C1 | C2 |
|---|---|---|---|---|---|---|
| 原样（artifact 记为失败） | 0.250 | 0.167 | 0.167 | 0.0556 | ✅ | ✅ |
| **乐观（artifact 记为成功）** | 0.125 | 0.167 | **0.000** | **0.0000** | ✅ | ❌ |

**结论：C2（差异化前提，delta≥0.03）在宽松判定下归零，C2 不稳健。** 若把假象全部原谅，GLM 的配置敏感性完全消失（gap 0.167→0.000），c_global 也从 step_by_step-p3 变为 step_by_step-p1。

## 4. 哪些结论仍然站得住

| 结论 | 稳健性 | 依据 |
|---|---|---|
| **C1 配置敏感性成立**（≥2 基座 gap≥10pp） | 稳健 | 乐观口径下 deepseek 0.125、qwen 0.167 仍 ≥0.10；qwen 的 artifact 率在 9 个配置上恒为 8%（均匀），其 gap 是 artifact-clean 的 |
| 「基座最优配置不同」 | **不稳健** | 乐观口径 delta=0，GLM 的「concise 更优」主要来自它更少触发 artifact |
| 「delta = 5.6pp」这个数值 | **不可引用** | 依赖 artifact 记账方式 |
| 工程链路（runner≡DSH、注入延迟、搜索器、协议纪律） | 稳健 | 与判定语义无关 |

## 5. 必须做的事（M3 之前）

1. **判定器健壮化**：答案匹配改为归一化（剥离 markdown 强调/代码块/空白/全角标点 + 提取首个 yes/no/数值 token）；属于**任务环境变更**，按协议 §8 走偏离流程（G0 数据作废重跑，或声明 G0 仅作 kill-test、结论以 M3 为准）。
2. **run_js CommonJS shim**：支持 `module.exports` / `exports.x`（同样是任务环境变更，同一偏离单）。
3. **G0 结论的对外表述**：对外只能说「C1 成立；C2 在当前判定语义下不稳健，修复后重测」——不能说「PASS → M2 的差异化前提已被证实」。M2 的插件工程价值不受影响（它不依赖 G0 的 C2）。
4. **可选的论文角度**：「prompt style 会系统性改变代码导出约定，进而与工具沙箱的兼容性耦合」本身是一个真实、可写的观察（失败分析章节的素材），而非单纯的噪声。

## 6. 复现

```bash
node analysis/g0_artifact_sensitivity.mjs
```
