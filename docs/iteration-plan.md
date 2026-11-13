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

**迭代 1 收尾（2026-11-13 复核）**：P0/P1/P2/P3 全部落地；dev 任务集 6/18、CI（.github/workflows/ci.yml）、README 刷新、analysis/g0_report.py 均已入库；基线 53/53 测试通过。以下各节的「⏳」状态标记以本节为准。

---

# 迭代 2 · M3 零成本就绪（2026-11-13 制定并实施）

> 目标：在不消耗任何 API 预算、不触碰任何冻结资产的前提下，让 M3 主实验「一键、合规、可复现」。
> 依据：迭代 1 完成后审计发现，`--execute` 路径存在确定性崩溃与实验纪律违规，M3 尚不具备执行条件。

## 现状审计（迭代 2 起点）

| 维度 | 状态 |
|---|---|
| M0–M2 | ✅ 完成（G0 PASS；策略库 + 三维度注入；一致性校验 gap=0） |
| 迭代 1 | ✅ 完成（halving 12 单测、dev 6 任务、CI、G0 统计脚本） |
| 基线 | ✅ build / typecheck 通过，vitest 53/53 |
| `scripts/run-search.ts --execute` | ❌ `process.exit(main())` 收到 Promise → Node 抛 `ERR_INVALID_ARG_TYPE`，跑批必然崩溃（实测） |
| 实验产物规范 | ❌ 缺 `episodes.jsonl`；`report.json` 缺 seed / commit / token 汇总 |
| infra_error 纪律 | ❌ `success === 'infra_error'` 被静默当作失败计入指标（违反协议 §2） |
| 前置门禁 | ❌ 任务集不足 30 仍可跑、无冻结校验、无预算批准留痕 |
| dev / test 任务集 | ⚠ dev 18/30（g0 12 + dev 6）；test 为空（须 M3 超参冻结前独立构造） |
| 搜索算法 | ⚠ `equalBudgetRandom` 未采样配置以 0 分参与择优；`scores` 跨轮 cohort 混合不可比 |
| 文档治理 | ⚠ README 测试数滞后（50 vs 53）；environment-status 表格错行；G0 决议正式签字待补 |

## 优先级与任务

| 优先级 | 任务 | 关键改动点 |
|---|---|---|
| **P0** | M3 跑批执行链修复与合规门禁 | `scripts/run-search.ts` 重写执行路径；新增 `packages/search/src/artifacts.ts` 统一三件套落盘 |
| **P1** | dev 任务集补齐 18/30 | `tasks/dev/` 新增 12 任务（tool/reasoning/code 各 4）+ 判定器 + 正反例自测 |
| **P2** | 搜索算法正确性 | `halving.ts`：未采样配置不计分；`scores` 语义标注 + 来源轮次；补单测 |
| **P3** | 文档与治理同步 | iteration-plan、environment-status（修错行）、README、tasks/dev/README |

## P0 详细规格

1. `main()` 改 async，出口用 `process.exitCode`，**禁止 `process.exit(Promise)`**；
2. 新增 `createArtifactWriter()`：写 `config.snapshot.json`（协议引用、g0/dev manifest hash、temperature、maxSteps、seeds、margin、weights、commit、approval）、逐行 append `episodes.jsonl`（schema = EpisodeRecord）、汇总 `report.json`（status、seed、commit、tokens、infra_errors、result）；
3. `infra_error` 按协议 §2：补跑一次并留痕；补跑仍失败 → **中止跑批**、`report.status = aborted_infra_error`、退出码非 0，绝不静默剔除或计入指标；
4. `--execute` 前置门禁（任一不满足即拒绝且不创建产物目录）：g0 manifest sha256 与冻结协议一致、`allTasks.length ≥ 30`、availability 已实测、`--approval <id>` 组长预算/超参冻结批准留痕、`.env` 密钥存在；
5. 新增 `--self-test`：注入确定性假 runner，零 API 端到端跑通三件套 + 一致性校验，产物写 `analysis/out/`（已 gitignore）；覆盖 halving 与 random 两条路径。

## P1 详细规格

- 新增 dev-tool-03..06、dev-reas-03..06、dev-code-03..06，共 12 个；沿用 G0 冻结数据表与 8 个 mock 工具；
- 判定器只用 `fileEquals` / `answerIncludes` / `codeChecker`；每任务正反例（含缺文件）自测先于入库；
- 不修改 `tasks/g0/**`、`configs/availability.yaml`、`policies.json`、`docs/g0-protocol.md`。

## 验收标准

1. `pnpm build && pnpm typecheck && pnpm test` 全绿，测试数 ≥ 65（新增 12 任务自测 + 算法/产物单测）；
2. `node --import tsx/esm scripts/run-search.ts --dry-run` 输出 27 配置 / 30 任务且**无任务缺口告警**；
3. `--self-test` 零 API 产出三件套，`episodes.jsonl` 行数 = `report.result.episodes`，必填字段齐全；
4. `--execute` 在缺批准 / 缺密钥 / 任务集不足时干净拒绝（不生成脏产物目录）；
5. 冻结资产零变更：`sha256sum tasks/g0/tasks.manifest.json` = `43059cb4…1004`；test 集仍为空且未运行；
6. 全程零 API 调用、零预算消耗。

## 范围外（明确本轮不做）

- M3 真实跑批、8 项基线、test 集一次运行（需组长批准 + 超参冻结 + 预算确认）；
- run_js CommonJS shim 与严格答案匹配修订（涉及任务环境/判定语义，须走协议 §8 偏离流程）；
- G0 决议正式签字（治理动作，需组长本人）；
- M4 发布、M5 微调。

## 迭代 2 实施结果（2026-11-13）

| 验收项 | 结果 |
|---|---|
| build / typecheck / test | ✅ 全绿；vitest **72/72**（原 53 → +12 dev 判定器自测、+5 产物规范、+2 算法回归） |
| dry-run | ✅ 27 合法配置、30 任务、零缺口告警；预计 648 episode/基座（27×6×1 + 9×12×2 + 3×30×3） |
| --self-test | ✅ halving 与 random 两条路径各 4 episode，三件套齐全、行数与 report 一致、PASS（exit 0，零 API） |
| --execute 门禁 | ✅ 缺 `--approval` → exit 1；缺 `.env` 密钥 → exit 1；均不创建产物目录；experiments/ 无新增脏目录 |
| 冻结资产 | ✅ `tasks/g0/tasks.manifest.json` sha256 仍为 `43059cb4…1004`；协议/availability/policies/test 集零改动 |
| API 消耗 | ✅ 0（全程未加载 `.env`） |

**关键决策记录**

1. **原 `--execute` 崩溃根因**：`process.exit(main())` 在异步分支收到 Promise，Node 抛 `TypeError [ERR_INVALID_ARG_TYPE]`（实测复现）。改为 `main().then(code => process.exitCode = code)`，异常走 1。
2. **infra_error 取「中止」而非「继续计入」**：补跑一次仍失败时写 `infra_error` episode 行 + `infra_errors` 清单 + `report.status = aborted_infra_error` + 退出码 2，等待组长决定补跑。比「当失败计入」更符合协议 §2 且不会污染搜索归因；补跑成功的原始 infra 原因另记入 `infra_reruns`，保证「禁止静默替换数据点」。
3. **新增 `--approval` 与任务集门禁**：M3 超参尚未冻结、预算需组长确认，跑批前强制留痕；门禁在创建产物目录之前执行，避免半截产物。
4. **随机对照修复**：未采样配置不再以 0 分参与择优（原实现在观测全为负时会凭空夺冠）；新增 `unevaluated` 透明留痕，`score_round` 标注 halving 分数来源轮次以消除跨轮误读。
5. **dev 任务设计**：复用 G0 冻结数据表，代码任务统一「全局函数 + solution.js + run_js 断言」，规避 G0 已知的 `vm × CommonJS` 失败模式；每任务正例/反例/缺文件三断言。
6. **self-test 产物写 `analysis/out/`**（已 gitignore），不污染 experiments/ 的正式实验记录。

**下一迭代候选（按序）**：① 构造并冻结 test 集（≥30 个独立任务，不运行）；② 冻结 M3 超参（奖励权重敏感性、halving 裕量、seed 与预算）并写入协议级文档；③ 组长批准后执行 M3 全量搜索与 8 项基线；④ 处理 run_js CommonJS shim（须走协议 §8 偏离）；⑤ 补 G0 决议正式签字。

