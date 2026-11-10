# 环境状态（M0）

更新：2026-11-10。逐项以实测为准，完成后回填证据。

| 项 | 状态 | 证据/备注 |
|---|---|---|
| Node | ✅ v24.16.0 | 满足 DSH engines >=24.9 |
| pnpm | ✅ 12.18.0（npm 全局）；DSH 用 corepack 按 packageManager 调 11.28.5 | corepack enable 因 Program Files 权限失败，改 `npm i -g pnpm`（全局目录在用户 AppData，可写） |
| 骨架依赖/构建/单测 | ✅ | pnpm install/build 通过；vitest 6/6 |
| DSH 源码 | ✅ commit fcc0ad46（docs/dsh-commit.lock） | codeload tarball 获取；vendor/ 已 gitignore |
| DSH 依赖安装 | ⏳ 进行中 | 首轮失败：cdn.sheetjs.com 被墙（xlsx 0.20.3，仅官方 CDN 有）；启动本机代理后重试 |
| DSH 构建 | ⬜ 待安装完成 | `corepack pnpm run build:artifacts`（开发用；完整 build 含 check） |
| 静态 preset 验证 | ⬜ 待构建 | docs/spike/preset-a/b.patch.yml 已备好 |
| Ollama | ⏳ 安装包下载中 | 官方源直连约 30KB/s，需代理；装后 `ollama pull qwen2.5:1.5b`（M5 前置，非 G0 阻塞） |
| Python 分析环境 | ⏳ venv 已建（3.11.16），依赖安装中 | uv 0.12.10；**必须** `--default-index https://registry.npmmirror.com/simple`（pypi.org 直连挂起） |
| API 密钥 | ⬜ 用户未提供（已确认跳过） | .env 未创建；阻塞：连通验证、可用性矩阵、G0 运行 |
| G0 协议冻结 | ⬜ 待组长签字 | docs/g0-protocol.md 第 9 节 |

## 本机网络要点（实测）

- GitHub 通路依赖代理客户端（127.0.0.1:7892）；代理未运行时 github.com/cdn.sheetjs.com 不可达，但 api.github.com、codeload.github.com、git push 当时可用（规则分域名）。
- npm/pnpm 镜像：registry.npmmirror.com（已设）；**例外**：xlsx 0.20.3 不在 npm/镜像，只在 cdn.sheetjs.com。
- PyPI：uv/pip 必须显式镜像源；系统 Python 3.14 的 pip 找不到 uv 包（uv 用独立安装版）。
- node 解析 /tmp 为 D:\tmp：临时文件用仓库内路径或管道。
- 密钥纪律：只放 .env（gitignore）；日志/提交前扫描（已做首轮 grep 扫描，无密钥）。

## 开源仓库

- https://github.com/cheng200606/meta-tuning-engine（public，main）
- 已推送：骨架 + G0 协议 + spike 结论 + preset 验证文件 + MIT LICENSE。