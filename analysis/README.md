# analysis/

统计分析与 M5 微调数据处理。**用 uv 管理 Python 3.11 虚拟环境**：

```bash
uv venv --python 3.11
# 本机直连 pypi.org 会挂起；npmmirror 无 PyPI simple 索引（404）、清华源 403，
# 实测阿里云镜像可用（2026-11-10）。uv 需 --native-tls 信任系统证书库（代理 MITM）。
uv pip install --native-tls --default-index https://mirrors.aliyun.com/pypi/simple/ pandas scipy scikit-learn matplotlib
```

不要用系统 Python 3.14（PyTorch/LLaMA-Factory 无对应 wheel）。
本机代理 MITM 环境下 requests/httpx 需设 `SSL_CERT_FILE` 指向代理根证书。