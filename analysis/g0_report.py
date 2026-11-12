# G0 结果统计（P3.3）：合并口径矩阵 + bootstrap 95% CI + 热力图。
# 数据：experiments/2026-11-10-m1-g0-full/{episodes.jsonl, repair-episodes.jsonl}
# 运行：analysis/.venv/Scripts/python.exe analysis/g0_report.py（仓库根）
import json
import os
import random

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXP = os.path.join(ROOT, "experiments", "2026-11-10-m1-g0-full")
OUT = os.path.join(ROOT, "analysis", "out")
os.makedirs(OUT, exist_ok=True)

BASES = ["deepseek-v3", "qwen3-8b", "glm-4.5-air"]
CONFIGS = [
    "concise-p1-roff", "concise-p2-roff", "concise-p3-roff",
    "step_by_step-p1-roff", "step_by_step-p2-roff", "step_by_step-p3-roff",
    "constrained-p1-roff", "constrained-p2-roff", "constrained-p3-roff",
]


def load_rows():
    rows = []
    for name in ("episodes.jsonl", "repair-episodes.jsonl"):
        with open(os.path.join(EXP, name), encoding="utf-8") as f:
            rows.extend(json.loads(line) for line in f if line.strip())
    # 合并口径：修复数据替换对应 infra 键
    seen = {}
    for r in rows:
        key = (r["base"], r["config_id"], r["task_id"], r["seed"])
        if r["success"] == "infra_error" and key in seen and seen[key]["success"] != "infra_error":
            continue
        seen[key] = r
    return [r for r in seen.values() if r["success"] != "infra_error"]


def cell(rows, base, config):
    return [1.0 if r["success"] is True else 0.0 for r in rows if r["base"] == base and r["config_id"] == config]


def bootstrap_ci(values, n=1000, seed=0):
    rng = random.Random(seed)
    if not values:
        return 0.0, 0.0
    means = [sum(rng.choices(values, k=len(values))) / len(values) for _ in range(n)]
    return sorted(means)[int(0.025 * n)], sorted(means)[int(0.975 * n)]


rows = load_rows()
matrix, ci = {}, {}
for b in BASES:
    for c in CONFIGS:
        v = cell(rows, b, c)
        matrix[(b, c)] = sum(v) / len(v) if v else 0.0
        ci[(b, c)] = bootstrap_ci(v)

per_model_best = {b: max(CONFIGS, key=lambda c: matrix[(b, c)]) for b in BASES}
gmean = {c: sum(matrix[(b, c)] for b in BASES) / len(BASES) for c in CONFIGS}
c_global = max(CONFIGS, key=lambda c: gmean[c])
delta = sum(matrix[(b, per_model_best[b])] for b in BASES) / len(BASES) - gmean[c_global]

# 热力图
fig, ax = plt.subplots(figsize=(10, 4))
data = [[matrix[(b, c)] for c in CONFIGS] for b in BASES]
im = ax.imshow(data, cmap="RdYlGn", vmin=0, vmax=1, aspect="auto")
ax.set_xticks(range(len(CONFIGS)), CONFIGS, rotation=30, ha="right", fontsize=8)
ax.set_yticks(range(len(BASES)), BASES)
for i in range(len(BASES)):
    for j in range(len(CONFIGS)):
        ax.text(j, i, f"{data[i][j]:.2f}", ha="center", va="center", fontsize=8)
fig.colorbar(im)
ax.set_title("G0 success rate r(b,c) — merged caliber (n=24 per cell)")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "g0-heatmap.png"), dpi=150)

# 摘要
with open(os.path.join(OUT, "g0-summary.md"), "w", encoding="utf-8") as f:
    f.write("# G0 统计摘要（合并口径，自动生成 analysis/g0_report.py）\n\n")
    f.write("| 基座 | 最优配置 | 最优完成率 [95% CI] | gap |\n|---|---|---|---|\n")
    for b in BASES:
        c = per_model_best[b]
        lo, hi = ci[(b, c)]
        gap = max(matrix[(b, cc)] for cc in CONFIGS) - min(matrix[(b, cc)] for cc in CONFIGS)
        f.write(f"| {b} | {c} | {matrix[(b, c)]:.3f} [{lo:.3f}, {hi:.3f}] | {gap:.3f} |\n")
    f.write(f"\n- c_global = {c_global}（跨基座均值 {gmean[c_global]:.3f}）\n")
    f.write(f"- delta（per-model 最优均值 − 全局最优）= **{delta:.3f}**（C2 阈值 0.03）\n")
    f.write(f"- 有效 episode：{len(rows)}（62 例 infra_error 已由修复跑替换）\n")

print("written:", os.path.join(OUT, "g0-summary.md"), "+ g0-heatmap.png")
print(f"delta={delta:.4f} c_global={c_global}")
