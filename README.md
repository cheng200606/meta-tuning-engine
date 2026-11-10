# meta-tuning-engine

基座感知型 Agent 元控制器：离线配置搜索 + 策略库 + DSH 注入插件（进阶期：轻量摊销预测）。

- 架构与论文定位：[../创新点.md](../创新点.md)
- 执行方案（里程碑/预算/分工）：[../开发实验方案.md](../开发实验方案.md)
- **当前状态：M0 未开工。先读 [docs/g0-protocol.md](docs/g0-protocol.md) 与 [docs/dsh-spike.md](docs/dsh-spike.md)。**

## 结构

```
packages/
  action-space/            配置 schema、校验、可用性裁剪、枚举（已实现 + 单测）
  runner/                  最小 ReAct 评测执行器（M1 实现，当前为类型骨架）
  search/                  网格/halving 搜索与奖励函数（奖励已实现，搜索 M3）
  policy-store/            策略库 JSON 读写（已实现最小版）
  plugin-meta-controller/  DSH 插件（M2，前置：dsh-spike 结论）
tasks/
  g0/                      12 个门禁任务清单（manifest 已冻结入协议）
  dev/ test/               M3 扩充；test 集冻结纪律见其 README
configs/                   基座清单与可用性矩阵（M0 填写）
experiments/               每次运行一个目录，产物规范见其 README
analysis/                  Python 3.11（uv），勿用系统 Python 3.14
docs/                      G0 协议、spike 记录、决议与报告
```

## 快速开始

```bash
# 前置：pnpm（corepack enable && corepack prepare pnpm@latest --activate）
pnpm install
pnpm build        # 拓扑序构建各包
pnpm test         # vitest（action-space + runner + G0 判定器自测）
pnpm typecheck    # 需先 build（workspace 依赖走 dist）

# G0 实验（需 .env 密钥 + 协议签字冻结 + availability 实测填写）
node --env-file=.env --import tsx/esm scripts/run-g0.ts --smoke   # 20 episode 冒烟
node --env-file=.env --import tsx/esm scripts/run-g0.ts --full    # 648 episode 门禁实验

# DSH preset 注入链路无密钥验证（需 vendor/deepseek-harness 已构建）
cd vendor/deepseek-harness && node --import tsx/esm ../../scripts/verify-presets.ts
```

密钥放 `.env`（参考 `.env.example`），绝不提交。

## 纪律

1. G0 判据先冻结签字，再跑任何实验；
2. test 任务集只跑一次；
3. experiments/ 产物必须带配置快照 + seed + commit hash；
4. DSH 锁定 commit（docs/dsh-commit.lock，M0 生成），升级前跑回归。