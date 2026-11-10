# analysis/

统计分析与 M5 微调数据处理。**用 uv 管理 Python 3.11 虚拟环境**：

```bash
uv venv --python 3.11
uv pip install pandas scipy scikit-learn matplotlib
```

不要用系统 Python 3.14（PyTorch/LLaMA-Factory 无对应 wheel）。
本机代理 MITM 环境下 requests/httpx 需设 `SSL_CERT_FILE` 指向代理根证书。