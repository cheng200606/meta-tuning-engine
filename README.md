# meta-tuning-engine

基座感知型 Agent 元控制器：离线配置搜索 + 策略库 + DSH 注入插件（进阶期：轻量摊销预测）。

- 架构与论文定位：[../创新点.md](../创新点.md)
- 执行方案（里程碑/预算/分工）：[../开发实验方案.md](../开发实验方案.md)
- 迭代方案（当前-待办）：[docs/iteration-plan.md](docs/iteration-plan.md)
- **当前状态：M2 正式完成（三维度注入 + 一致性校验 gap=0），进入 M3。进展明细以 [docs/environment-status.md](docs/environment-status.md) 为准。**

## 结构

```
packages/
  action-space/            配置 schema、校验、可用性裁剪、枚举（已实现 + 单测）
  runner/                  最小 ReAct 评测执行器（ReAct 循环 + mock 工具 + 配置注入 + infra 重试）
  search/                  奖励函数 + successive halving 搜索 + 等预算随机对照（已实现 + 单测）
  policy-store/            策略库 JSON 读写（policies.json：三基座 G0 最优已入库）
  plugin-meta-controller/  DSH 元控制器插件（persona preset + agent/created select + reasoning 注入）
                           与 g0-tools（G0 mock 工具的 DSH 通道，供一致性校验）
tasks/
  g0/                      12 个门禁任务（manifest 已冻结入协议）
  dev/                     M3 搜索用任务集（当前 6/18 新任务，构造规范见其 README）
  test/                    保留集（M3 结束前冻结，只跑一次）
configs/                   基座清单与可用性矩阵（实测填写）
experiments/               每次运行一个目录，产物规范见其 README
analysis/                  Python 3.11（uv），勿用系统 Python 3.14
docs/                      G0 协议、spike 记录、决议、环境状态、迭代方案
scripts/                   G0 流水线 / M2 验证 / 一致性校验 / 搜索 CLI
vendor/deepseek-harness/   DSH 源码（gitignore，commit 锁定）
```

## 快速开始

```bash
# 前置：pnpm（corepack enable && corepack prepare pnpm@latest --activate）
pnpm install
pnpm build        # 拓扑序构建各包
pnpm test         # vitest（50 用例：schema / 判定器自测 / runner / 搜索）
pnpm typecheck    # 需先 build（workspace 依赖走 dist）

# G0 实验（需 .env 密钥；协议已冻结，重跑前读 docs/g0-protocol.md §8）
node --env-file=.env --import tsx/esm scripts/run-g0.ts --smoke   # 20 episode 冒烟
node --env-file=.env --import tsx/esm scripts/run-g0.ts --full    # 648 episode 门禁实验

# M2 验证（无密钥，需 vendor/deepseek-harness 已构建）
cd vendor/deepseek-harness
node --import tsx/esm ../../scripts/verify-plugin.ts            # 三维度注入验证
node --import tsx/esm ../../scripts/verify-consistency-smoke.ts # 一致性通道冒烟

# 一致性校验（真实模型，双通道 24 episode，M2 出口）
node --env-file=.env --import tsx/esm scripts/run-consistency.ts   # 在仓库根执行
```

密钥放 `.env`（参考 `.env.example`），绝不提交。

## 纪律

1. G0 协议已冻结：改判据/参数 = 实验作废，偏离走协议 §8 流程；
2. test 任务集只跑一次（M3 超参冻结后）；
3. experiments/ 产物必须带配置快照 + seed + commit hash；
4. DSH 锁定 commit（docs/dsh-commit.lock），升级前跑回归；
5. infra_error 不计入指标、禁止静默剔除（协议 §2）。
