# DSH Spike 记录（M0）

锁定 commit：`________________`（写入 docs/dsh-commit.lock）
核查日期：`________________`

逐项给出**结论 + 源码位置/原文证据**，不得只写"已确认"。

## 1. PresetDefinition.plugins 数组项格式
- 入口：packages/preset/agent-preset-registry 的 `mountPreset`（preset 作为 Cordis include 子树挂到 agent scope）
- 结论（项是字符串 / [name, config] / 对象？给出示例）：
- 证据：

## 2. agentPresets.select 时机与 agent-preset-locked 语义
- 会话级还是全局级？agent 对象从哪来？
- 结论：
- 证据：

## 3. 会话创建 / 模型切换事件
- `session/event` 的 type 枚举中相关项：
- 结论：
- 证据：

## 4. headless / 批量运行能力
- 查 CLI 参数、Node SDK、Web API；
- 结论：有（用法：____）/ 无 → 启用自研 runner 预案
- 证据：

## 5. 可用性矩阵实测
- 对 configs/bases.yaml 三个基座各发一次探测请求（双 tool call 请求 / reasoning_effort 参数），填 configs/availability.yaml：
- 结论与请求记录：

## 静态 preset 验证（M0 出口）
- [ ] 两个静态 preset（不同 system prompt + 不同 maxParallelToolCalls）经 cordis.yml --patch 加载
- [ ] Web UI 切换后行为差异可观测（记录截图/trace）