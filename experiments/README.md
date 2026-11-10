# experiments/ 产物规范

每次运行一个目录：`<YYYY-MM-DD>-<里程碑>-<slug>/`，例如 `2026-11-15-m1-g0-smoke/`。

必含：
- `config.snapshot.json`：基座、配置矩阵、seed、temperature、步数上限、任务集 manifest hash、仓库 commit hash、DSH commit（如涉及）；
- `episodes.jsonl`：每 episode 一行，schema 见 packages/runner 的 EpisodeRecord；
- `report.json`：汇总指标、判据计算结果、预算消耗。

`traces/`（完整对话轨迹）不进 git（已 ignore），本地留存备查。