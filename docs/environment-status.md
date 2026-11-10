# 环境状态（M0）

更新：2026-11-11 03:05。逐项以实测为准，完成后回填证据。

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
| G0 全量实验 | ✅ 2026-11-11 02:47 完成 | 648 episode；**C1（3/3 基座 gap≥10pp）+ C2（delta=7.3pp）通过 → PASS 进 M2**；infra_error 62 例留痕（qwen 429 限流）；费用 ≈¥37（上界单价）＜¥150 上限；判据经独立重算复核与 report.json 一致；决议 docs/g0-decision.md 待组长签署（Qwen 缺失数据修复 A/B/C 待决策） |

## 本机网络要点（实测）

- GitHub 通路依赖代理客户端（127.0.0.1:7892）；代理未运行时 github.com/cdn.sheetjs.com 不可达，但 api.github.com、codeload.github.com、git push 当时可用（规则分域名）。
- npm/pnpm 镜像：registry.npmmirror.com（已设）；**例外**：xlsx 0.20.3 不在 npm/镜像，只在 cdn.sheetjs.com。
- PyPI：uv/pip 必须显式镜像源；系统 Python 3.14 的 pip 找不到 uv 包（uv 用独立安装版）。
- node 解析 /tmp 为 D:\tmp：临时文件用仓库内路径或管道。
- 密钥纪律：只放 .env（gitignore）；日志/提交前扫描（已做首轮 grep 扫描，无密钥）。

## 开源仓库

- https://github.com/cheng200606/meta-tuning-engine（public，main）
- 已推送：骨架 + G0 协议 + spike 结论 + preset 验证文件 + MIT LICENSE。