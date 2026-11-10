# G0 任务集

- `tasks.manifest.json` 是唯一事实来源：任务指令为最终措辞，其 sha256 记录在 `docs/g0-protocol.md`，冻结后不得修改。
- `env/`（M1 建）：mock 工具环境。工具清单：read_file / write_file / list_dir（每 episode 重置的虚拟文件系统）、calculate（mathjs 安全求值，禁 eval）、get_weather / get_city_info / query_orders（内置固定数据表）、run_js（node:vm 沙箱 + 2s 超时）。
- `env/fixtures/`（M1 建）：各任务预置文件（sales.csv、orders.json、rules.txt、bug_sort.js 等），内容必须与 manifest 的 fixtures 描述一致。
- `checks/`（M1 建）：每任务一个 `<id>.ts` 判定器，确定性断言，满足 manifest 的 expected。判定器开跑前须用正例/反例各一自测通过；开跑后不得修改判定标准。