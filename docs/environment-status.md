# 环境状态（M0 → M3 准备期）

更新：2026-11-13（迭代 2 回填；以下各行保留当时实测结论）。逐项以实测为准，完成后回填证据。

**M1 提前完成项**：runner（ReAct 循环 + mock 工具 + 配置注入 + infra 重试）与 G0 流水线（scripts/run-g0.ts，含协议冻结校验、availability 门禁、C1/C2 自动计算）已实现，35/35 测试通过；密钥就绪即可跑冒烟。

| 项 | 状态 | 证据/备注 |
|---|---|---|
| Node | ✅ v24.16.0 | 满足 DSH engines >=24.9 |
| pnpm | ✅ 12.18.0（npm 全局）；DSH 用 corepack 按 packageManager 调 11.28.5 | corepack enable 因 Program Files 权限失败，改 `npm i -g pnpm`（全局目录在用户 AppData，可写） |
| 骨架依赖/构建/单测 | ✅ | pnpm install/build 通过；vitest 6/6 |
| DSH 源码 | ✅ commit fcc0ad46（docs/dsh-commit.lock） | codeload tarball 获取；vendor/ 已 gitignore |
| DSH 依赖安装 | ✅ | pnpm 11.28.5（corepack），显式 https-proxy=127.0.0.1:7892 + NODE_OPTIONS=--use-system-ca 后成功（sheetjs CDN 需代理） |
| DSH 构建 | ✅ | build:artifacts：8 gates passed，367 client artifacts，143s |
| 静态 preset 验证 | ✅ 无密钥 mock 通过 | scripts/verify-presets.ts：注册→agent/created select→persona 进入模型请求；关键限制见 dsh-spike.md（headless 不组合 preset、preset 内禁放 agent-loop） |
| Ollama | ❌ 已取消（用户决定 2026-11-10） | 修订架构 G0–M3 不需要小模型；Ollama 仅可选 M5 前置，届时再议（M5 也可能被 kNN 基线替代） |
| Python 分析环境 | ✅ | uv 0.12.10 + Python 3.11.16；pandas/scipy/sklearn/matplotlib 导入通过；阿里云 PyPI 镜像 + --native-tls |
| API 密钥 | ✅ 用户已填 .env（2026-11-10） | 三基座连通验证通过；llama-3.3-70b 被硅基流动下线，按预案替换为 glm-4.5-air（协议 §10 记录） |
| G0 协议冻结 | ✅ 组长程夏 2026-11-10 签字 | v1.0-已冻结；冒烟 20 episode 通过（16/20，失败为真实任务失败）；预算核对通过 |
| G0 全量实验 | ✅ 2026-11-11 02:47 完成 | 648 episode；C1+C2 通过（原口径 delta=7.3pp）；infra_error 62 例留痕（qwen 429 限流）；判据经独立重算复核与 report.json 一致 |
| G0 infra 修复跑 | ✅ 2026-11-11 06:05 完成 | 62/62 回收（qwen 56 + glm 6），0 例仍失败；产物独立文件（repair-episodes.jsonl / repair-report.json），原数据未改动；合并口径每格 n=24 满格，C1+C2 仍通过（delta=5.6pp，qwen 最优移至 step_by_step-p1）；修复消耗 1.02M tokens（≈¥14），总计 3.80M ≈¥51＜¥150 上限；决议 docs/g0-decision.md 待组长签字 |
| G0 决议生效 | ✅ 2026-11-11 | 组长批准选项 A + 指示继续，口头批准留痕（正式签字待补）；双修复跑透明记录于决议文档；主口径=分离文件修复（838529f） |
| M2 策略库+插件 | ✅ 2026-11-11 | policies.json 三基座 G0 最优配置入库；plugin-meta-controller 真实实现（策略库→preset→agent/created select）；scripts/verify-plugin.ts 无密钥端到端验证两基座 persona 注入通过；build/typecheck/35 测试全绿。范围：prompt_style 维度；parallel/reasoning 注入留 M2.1（preset 内禁放 agent-loop，需根部配置机制） |
| M2.1 三维度注入 | ✅ 2026-11-12 | maxParallelToolCalls 经根部 agent-loop config 覆盖行（cordis Volatile 外部只读，overlay 生成器 overlay.ts 与插件同读一份 policies.json）；reasoning_effort 经 agent.model.select() 运行期注入（off 不干预）；verify-plugin.ts 三用例全绿（deepseek-v3/glm-4.5-air/合成 reasoning=low，断言首步实际生效值）；注入延迟 lookup 0.46–1.19ms、select ≈1ms（<100ms 目标达成）。关键坑：agent/pre-step 是 waterfall 事件，监听者必须转发 next()（dsh-spike.md §6） |
| 一致性校验 DSH 侧通道 | ✅ 通道就绪（2026-11-12 冒烟） | g0-tools.ts 插件按路径复用 runner 的 MockTools（语义零漂移）+ FS 快照交接判定器；无密钥冒烟（g0-tool-04）全链路通过。**剩余：真实模型 6 任务 × 2 配置双通道对比（≤10pp 即 M2 出口）**；线格式与 session-title 计量注意事项见 dsh-spike.md §7 |
| M2 出口一致性校验 | ✅ 2026-11-13 | 24 episode（deepseek-v3 × 6 任务 × 2 配置 × 双通道 × seed 0）：**runner vs DSH 完成率差 = 0（两配置完全一致），≤10pp 门禁通过，M2 正式完成**。残余失败项为两通道对称的已知判定语义（严格答案匹配、vm×CommonJS），非通道差异。诊断历程：run1/run2 根因 = 一致性 overlay 漏挂 g0-tools（模型改用 DSH 内置工具写真实沙箱）+ restrict 修复，三份报告留档于 experiments/2026-11-12-m2-consistency/；工具隔离与工具使用档案已固化进 g0-tools |
| 迭代 1（halving / dev 6 / CI / 统计脚本） | ✅ 2026-11-13 | packages/search successive halving + 等预算随机对照（12 单测）、run-search CLI 骨架、dev 6 任务、GitHub Actions CI、analysis/g0_report.py（bootstrap 95% CI + 热力图，与 TS 口径交叉验证一致）；基线 53/53 测试通过 |
| 迭代 2 · M3 零成本就绪 | ✅ 2026-11-13 | 修复 `--execute` 崩溃（原 `process.exit(Promise)` → Node `ERR_INVALID_ARG_TYPE`）；新增统一产物落盘器（三件套 + infra_error 中止/留痕 + 冻结/30任务/批准/密钥门禁 + `--self-test`）；dev 补齐 18/18 → 任务集 30/30；修复随机对照未采样配置以 0 分参与择优；基线 build/typecheck/72 测试全绿；dry-run 无缺口告警，self-test 双路径产物合规，全程零 API 消耗 |

## 本机网络要点（实测）

- GitHub 通路依赖代理客户端（127.0.0.1:7892）；代理未运行时 github.com/cdn.sheetjs.com 不可达，但 api.github.com、codeload.github.com、git push 当时可用（规则分域名）。
- npm/pnpm 镜像：registry.npmmirror.com（已设）；**例外**：xlsx 0.20.3 不在 npm/镜像，只在 cdn.sheetjs.com。
- PyPI：uv/pip 必须显式镜像源；系统 Python 3.14 的 pip 找不到 uv 包（uv 用独立安装版）。
- node 解析 /tmp 为 D:\tmp：临时文件用仓库内路径或管道。
- 密钥纪律：只放 .env（gitignore）；日志/提交前扫描（已做首轮 grep 扫描，无密钥）。

## 开源仓库

- https://github.com/cheng200606/meta-tuning-engine（public，main）
- 已推送：骨架 + G0 协议 + spike 结论 + preset 验证文件 + MIT LICENSE。
| test 保留集冻结 | ✅ 2026-11-14 | 30 个独立任务（10/10/10）构造完成，90 正反例断言全绿；manifest sha256=bcafdca1…44ee 已记录于 tasks/test/README.md；纪律：M3 超参冻结后只跑一次。全套 162/162 测试 |
| DEV-01 判定器健壮化 + CommonJS 垫片 | ⏳ 代码完成，待批准重测（2026-11-19） | 判定器改语义等价匹配（answer-normalize.ts + answerYesNo/answerNumber/answerIncludesAny）+ run_js CommonJS 垫片（module.exports 兼容）；182/182 测试绿，冻结资产 sha256 未变；偏离单 docs/m3-deviation-01-judger-robustness.md；重测预算：诊断 162 episode ≈¥13 → 全量 648 episode ≈¥51。**预期 C2 仍不通过（点估计 0.000–0.028 < 0.03）——我们是为了知道真相，不是挽救结论** |
| GitHub 推送备用通道 | ✅ 2026-11-19 | github.com:443 不可用（时通时断，代理 7892 虽在监听但经其连 github 失败）而 api.github.com 直连可用 → 新增 scripts/push-via-api.ts：走 Git Data API 重建提交（tree/parent/author/committer/message 与本地完全一致 → API 返回相同 SHA，推送后仍 fast-forward）。踩坑：日期必须保留原始时区偏移（+08:00 非 Z）、message 必须保留结尾换行，否则 commit SHA 不一致。凭据取自 git-credential-manager，不落盘 |
