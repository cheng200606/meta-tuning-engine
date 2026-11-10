# DSH Spike 记录（M0）

锁定 commit：`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`（docs/dsh-commit.lock）
核查日期：2026-11-10
获取方式：github.com 主站当时不可达，经 codeload.github.com tarball 获取 master 源码（无 .git，commit SHA 来自 api.github.com/commits/master）；vendor/ 已 gitignore。

逐项给出**结论 + 源码位置/原文证据**，不得只写"已确认"。

## 1. PresetDefinition.plugins 数组项格式 —— 已确认（源码级 + 官方 YAML 范例）
- 结论：plugins 是 **Cordis Loader 条目列表（EntryOptions[]）**，YAML 形式为 `{id, name, config}` 行；分组用 `name: cordis:group, group: true, isolate: {...}`。preset 本体是一条 `name: '@deepseek-ai/dsh-agent-preset'` 的插件行，config 即 PresetDefinition（id/name/order/plugins）。
- 证据：packages/preset/agent-preset-registry/src/mount.ts:204-209（`prepareProfileEntries(ctx, plugins as EntryOptions[], ...)`）；**官方范例** packages/bundle/web-app/presets/minimal.patch.yml（persona 行：`name: '@deepseek-ai/dsh-persona', config: {prefix, complete, includeRuntimeContext}`）。
- 系统提示词落点修正：官方 preset 用 **dsh-persona 插件的 prefix**（而非直接调 systemPrompt.section）；M2 插件生成 preset 时沿用此形式。
- **关键约束**（mount.ts:213）：preset 子树发布的服务必须位于 isolate realm，否则 mount 拒绝（`Preset services require isolate realms`）。
- 挂载前提（:205）：`mounting requires a scope`。
- 函数插件导出规范（packages/AGENTS.md）：named export `name / inject / Config / apply`，不得有 default export。
- 验证文件已备好：docs/spike/preset-a.patch.yml / preset-b.patch.yml（待 DSH 构建完成后加载验证）。

## 2. agentPresets.select 时机与 agent-preset-locked 语义 —— 已确认（源码级）
- 结论：`select(agent: Agent, agentPreset: string): Promise<string>`，**会话级**，且**必须在会话开始前调用**——会话已启动时抛 `agent-preset/locked: This session has already started`。选中结果以 `agent-preset/selected` 事件追加进 session 日志。
- 证据：packages/preset/agent-preset-registry/src/index.ts:364-375（@Remote('select') 实现）；mount.ts:26-36（standing mount 按 scope 共享）。
- 对插件的含义：元控制器必须在会话创建早期（首条模型请求前）完成 select；运行中切换 preset 不被允许，「模型切换时重新适配」需以新会话承载。

## 3. 会话创建 / 模型切换事件 —— 部分确认
- 结论：preset 选中事件链路已确认：registry 监听 `ctx.on('session/event', (session, event) => ...)`，当 `event.type === 'agent-preset/selected'` 时向根上下文转发同名事件（载荷 session.id + agentPreset）。
- 证据：packages/preset/agent-preset-registry/src/index.ts:76-77。
- 待补：会话创建事件的确切 type（M2 开工时在 packages/session / core/agent 中查 SessionEventMap；select 时机约束已明确，创建事件只影响钩子写法）。

## 4. headless / 批量运行能力 —— 已确认：有
- 结论：**存在 headless 模式**。`dsh headless "task"`：回答单个任务、打印结果、退出；源码运行 `pnpm dsh --profile headless "task"`（需要 DEEPSEEK_API_KEY）。
- 证据：apps/cli/src/args.ts:95（`dsh headless "run the tests"  answer one task, print the result, and exit`）；根 AGENTS.md Commands 节。
- 对方案的影响：开发实验方案 §3.4 的「无 headless 预案」前提被推翻——评测**可以**直接驱动 DSH headless。但 G0 需要 mock 工具与确定性环境，M1 需决策：a) 自研 runner（现方案，控制力最强）b) DSH headless + mock 工具插件（与最终注入载体一致，省去一致性校验）。倾向 b 为主、a 为对照，M1 开工时定。

## 5. 可用性矩阵实测 —— 阻塞：需要 API 密钥
- 对 configs/bases.yaml 三个基座各发一次探测请求（双 tool call 请求 / reasoning_effort 参数），填 configs/availability.yaml：
- 结论与请求记录：待 DEEPSEEK_API_KEY / SILICONFLOW_API_KEY 就绪后执行。

## 静态 preset 验证（M0 出口）—— 已通过（2026-11-10，无密钥 mock 验证）
- [x] 两个静态 preset 经 --patch 加载（headless profile 需额外插入 agent-preset-registry，见 preset-registry.patch.yml）
- [x] agent/created 时 select → persona 进入模型请求（scripts/verify-presets.ts，报告 docs/spike/verify-presets-report.json：defaultPresetPersonaInjected=true，0 pending warnings）
- [ ] Web UI 真实模型下的行为差异截图（待 API 密钥；机制已由 mock 验证）

### 验证中发现的关键工程事实（M2/M1 必须遵守）
1. **headless 一次性 runner 不组合 preset**（packages/bundle/headless/src/index.ts:223-232 甚至拒绝 adopt 带 preset 的会话）→ **G0 评测不能用 `dsh headless` 驱动 preset 配置**；M1 评测通道改为：a) 自研 runner（现方案）b) Web/SDK 通道驱动 DSH。原「headless 为主」倾向作废。
2. **preset 内不得放 agent-loop**：与根部 agentLoop 服务冲突（service already registered）；官方 preset 只含 persona/工具/compaction 等，循环留在根组合。maxParallelToolCalls 用根部配置覆盖行（`- id: agent-loop\n  config:`）或 agent-loop 的 per-agent `agents` 配置（M2 细化）。
3. **select 时机**：`agent/created` 事件（packages/core/agent/src/runtime-types.ts:290）内调用可行且通过验证；docs/spike/meta-verify-select.ts 即 M2 元控制器最小原型。
4. launcher 旗标顺序：`dsh --patch x.yml --profile headless "task"`（--patch 在 profile 前）；headless app 自身不认 --patch。
5. mock LLM 直启：`node --import tsx/esm packages/test-support/llm-mock-server/src/bin.ts --sequence success --repeat-last --port 8000`（pnpm run mock:llm 的 `--` 转发会丢参数）；编程接口 startMockLlmServer 保留完整请求体（验证脚本用法）。
6. 会话日志为 zstd 压缩（session.v4.jsonl.zstd），Node 24 zlib.zstdDecompressSync 可读；headless 短会话可能只刷 header，请求体快照在模型请求的 dsh_session_log 字段内。