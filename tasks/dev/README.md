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

## 已入库（2026-11-13，本轮 6/18）

| id | 类 | 考点 |
|---|---|---|
| dev-tool-01 | tool | 多行数字求和 → calculate → 写 total.txt |
| dev-tool-02 | tool | 天气阈值分支（≥20℃ 取 no），反向于 g0-tool-02 |
| dev-reas-01 | reasoning | 两城人口比较，回答较少城市 |
| dev-reas-02 | reasoning | 文件内链式算式（x=5,y=x*7,z=y-9），calculate 分步求值写 z.txt |
| dev-code-01 | code | sumPositive：负数过滤求和（含空数组边界） |
| dev-code-02 | code | countVowels：大小写不敏感元音计数（含无元音/混合） |
