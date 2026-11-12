# 迭代方案（2026-11-13 制定，随进展滚动修订）

> 依据：M0–M2.1 已交付（见 docs/environment-status.md），本方案规划从「M2 出口验证」到「M3 可执行」的最短路径。
> 纪律不变：test 集冻结只跑一次；协议冻结参数不动；experiments/ 产物带快照 + seed + commit。

## 现状快照（审计结论，2026-11-13）

| 维度 | 状态 |
|---|---|
| G0 门禁 | ✅ 通过（C1 3/3 基座、C2 delta=5.6pp 合并口径），决议待补正式签字 |
| M2 策略库+插件 | ✅ persona 注入 + 无密钥端到端验证 |
| M2.1 三维度注入 | ✅ parallel（根部覆盖行）+ reasoning（model.select）+ 延迟 0.46–1.19ms |
| 一致性校验（M2 出口唯一阻塞项） | ⏳ DSH 侧通道已建成并冒烟通过；**真实模型对比未跑** |
| packages/search | ⏳ reward() + minMax 归一化已实现；`successiveHalving()` 是 TODO 桩 |
| 任务集 | g0 12 个（冻结）；dev/ test/ 为空（M3 前须扩充） |
| 测试 | 35/35（action-space 6 + 判定器自测 24 + runner 5）；search 包 0 测试 |
| CI / 开源门面 | 无 CI；README 状态行滞后于 environment-status |
| 预算消耗 | G0 全量 + 修复 ≈ ¥51（上界单价），协议默认上限 ¥150 |

## P0 — M2 出口：真实模型一致性校验（阻塞项，先做）✅ 2026-11-13 完成

**结果**：gap = 0（两配置 runner/dsh 完成率完全一致，24 episode）→ **M2 正式出口达成，进入 M3**。诊断历程与三份中间报告见 experiments/2026-11-12-m2-consistency/（根因：overlay 漏挂 g0-tools，模型改用 DSH 内置工具；工具隔离修复后双通道逐任务对称）。

**任务**：
1. `scripts/run-consistency.ts`：deepseek-v3 × 6 任务（tool/reasoning/code 各 2）× 2 配置（step_by_step-p3 与 concise-p1，刻意对比）× seed 0 × 双通道 = 24 episode；
   - runner 通道：直接调 `runEpisode`；
   - DSH 通道：headless + overlay（meta-controller + g0-tools + agent-loop 覆盖行），**禁用 session-title**（防计量污染），真实密钥走 `.env`；
2. 每集产出 `{task, config, channel, pass, reason}`，落 `experiments/<date>-m2-consistency/`（按 experiments/README 规范三件套）；
3. report.json 给出双通道完成率与差值、逐集明细；**≤10pp 判 M2 出口达成**，>10pp 则修 runner 语义对齐（只允许修 runner，不动判定器）。

**验收**：experiments/ 目录三件套齐全 + report.json 双通道差值结论 + environment-status 回填。
**预算**：~24 episode ≈ ¥2（上界单价）。
**风险**：DSH 线格式/工具错误文案与 runner 有差 → 记录差异不遮掩；单集 API 失败按 infra_error 处理（补跑一次）。

## P1 — M3 核心算法：successive halving 搜索器（纯本地，零 API）✅ 2026-11-13 完成

**结果**：任务 1–5 全部落地。search 包 12 个单测（淘汰/裕量并列/预算记账/可复现/边界）；`scripts/run-search.ts` CLI：`--help`、`--dry-run`（无密钥枚举 27 配置 + 轮次预算估算，任务集缺口如实警告）、`--execute`（已接 runEpisode 通道，缺密钥时干净报错，真实跑批 M3 接密钥执行）。

**任务**：
1. 实现 `successiveHalving(configs, tasks, episodeRunner, schedule)`：27→9→3→1（淘汰裕量 5pp，并列保留），episode 预算按方案 §6.2；
2. 实现等预算随机搜索对照（同预算随机采样配置）；
3. 奖励函数接线：score = 0.6·success + 0.2·tool_accuracy − 0.1·steps − 0.1·cost（min-max 归一，已有实现）；
4. **单测**：用注入的假 episodeRunner（确定性结果表）验证淘汰逻辑、平局保留、预算记账、随机对照等预算——目标 search 包测试 ≥10 个；
5. `scripts/run-search.ts` CLI 骨架（真实跑批 M3 执行时接密钥）。

**验收**：`pnpm test` search 包新增用例全绿；CLI --help 可运行。
**风险**：0（本地确定性）。

## P2 — dev 任务集扩充（内容工程，为 M3 备料）

**任务**：
1. 制定 dev 任务构造规范（三类均衡、与 g0 措辞模板一致、fixtures 描述式）；
2. 从 g0 的 12 个并入 dev 起步（方案 §6.1：dev 30 = g0 12 + 新增 18）；
3. 本轮先补 **6 个新任务**（tool/reasoning/code 各 2）+ 判定器正反例自测；其余 12 个列清单留给后续会话/协作。

**验收**：新任务判定器自测通过（并入 selftest.test.ts）；不触碰 g0 冻结区。
**风险**：低（纯本地）。判定器质量纪律：先正反例自测再入库。

## P3 — 工程质量与门面（低成本高观感）

**任务**：
1. GitHub Actions CI：pnpm install → build → typecheck → test（push/PR 触发）；
2. README：结构、快速开始、当前状态行刷新（指向 environment-status）；
3. analysis/ 增加一个 G0 结果统计脚本（矩阵热力图 + bootstrap CI），用现有 experiments 数据跑通。

**验收**：CI 配置入库且本地模拟通过；README 三屏讲清；analysis 脚本产出图。

## 执行顺序与预期产出

P0 → P1 → P3.1 → P2 → P3.2/3.3。本轮会话目标：P0 全部、P1 全部、P3.1；P2/P3 其余视时间推进。
完成后的整体水平：M2 正式出口、M3 算法层就绪可测、CI 上线——从「实验跑通」到「工程可复用」。
