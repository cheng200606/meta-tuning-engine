# dev 任务集（M3 扩充）

- 规模 30 个：G0 的 12 个并入 + 新增 18 个，tool / reasoning / code 三类均衡。
- 用途：配置搜索与奖励权重调参。允许迭代，但每次运行记录任务集版本。
- 新增任务沿用 G0 的 manifest + checker 规范。

## 构造规范（新增任务必须遵守，2026-11-13 增补）

1. **复用 G0 冻结数据表**（packages/runner/src/data-tables.ts）：天气 北京5/上海12/广州24；城市 上海/杭州；订单 C001。不得修改数据表——那是 G0 冻结资产。
2. 三类均衡：tool / reasoning / code；工具面就是 runner 的 8 个 mock 工具，任务可解性以它们为准（calculate 仅四则与括号）。
3. 每任务：manifest 条目（id/category/instruction/fixtures/tools_expected/expected）+ fixtures（如需，env/fixtures.ts）+ 判定器（checks/）+ **正反例自测**（checks/selftest.test.ts，先自测后入库）。
4. 指令措辞与 g0 模板风格一致，避免措辞引入额外变量。
5. 判定器只用 checker-types 的公共断言（fileEquals/answerIncludes/ok/fail）与 codeChecker 模式（读 solution.js + run_js 断言）。
6. dev 集**不冻结**（M3 超参冻结前可增改）；test 保留集独立构造且只跑一次（tasks/test/README.md）。

## 已入库（18/18，2026-11-13 迭代 2 补齐；任务集 g0 12 + dev 18 = 30，三类各 10）

| 批次 | id 范围 | 类 | 考点 |
|---|---|---|---|
| 迭代 1 | dev-tool-01 | tool | 多行数字求和 → calculate → 写 total.txt |
| 迭代 1 | dev-tool-02 | tool | 天气阈值分支（≥20℃ 取 no），反向于 g0-tool-02 |
| 迭代 1 | dev-reas-01 | reasoning | 两城人口比较，回答较少城市 |
| 迭代 1 | dev-reas-02 | reasoning | 文件内链式算式（x=5,y=x*7,z=y-9），写 z.txt |
| 迭代 1 | dev-code-01 | code | sumPositive：负数过滤求和（含空数组边界） |
| 迭代 1 | dev-code-02 | code | countVowels：大小写不敏感元音计数 |
| 迭代 2 | dev-tool-03 | tool | list_dir → read_file 提取 ticket（Q7-42） |
| 迭代 2 | dev-tool-04 | tool | 读 expr.txt → calculate 求 (12+8)*3 → 写 calc.txt |
| 迭代 2 | dev-tool-05 | tool | query_orders + calculate 求订单总额 1050 |
| 迭代 2 | dev-tool-06 | tool | 上海 12℃ < 15℃ 分支 → heater.txt=on |
| 迭代 2 | dev-reas-03 | reasoning | 三城天气取最暖（广州） |
| 迭代 2 | dev-reas-04 | reasoning | 两城人口差值 12350000 → pop_diff.txt |
| 迭代 2 | dev-reas-05 | reasoning | 订单总额 1050 ≤ 1100 阈值 → vip1100.txt=no |
| 迭代 2 | dev-reas-06 | reasoning | 订单平均额 1050/3=350（含除法）→ order_avg.txt |
| 迭代 2 | dev-code-03 | code | maxOf：最大值（含负数、单元素） |
| 迭代 2 | dev-code-04 | code | reverseString：边界空串、大小写混合 |
| 迭代 2 | dev-code-05 | code | isPrime：2 / 合数 / 1 边界 |
| 迭代 2 | dev-code-06 | code | uniqueSorted：去重升序（JSON.stringify 比较） |

**纪律**：dev 集不冻结（M3 超参冻结前可增改），但每次运行把 `manifest.json` 的 sha256 写入 `config.snapshot.json`；
g0 冻结资产（`tasks/g0/**`、`packages/runner/src/data-tables.ts`）一律不动。判定器正反例自测共 18 个用例（每任务正例/反例/缺文件）。
