---
author: W
featured: false
draft: false
description: how to deploy and inference LLM model locally
pubDatetime: 2025-03-16T01:23:45Z
title: 如何本地部署DeepSeek推理
tags:
  - llm
---

### 结论

使用vllm。

### 需求

这里提到的本地部署，更多是针对企业内部，或者某个政府机关内部，为了正式的业务需求而部署推理能力。而不是一个人在家里为了玩玩，随便跑一下。如果用英文表达，应该是deploy LLM model in private (on-prem / local) for inference

### 另外，QWEN

阿里千问也是个不错的本地部署选项，里面“部署”提到了vllm，TGI，SkyPilot，openllm https://qwen.readthedocs.io/zh-cn/latest/ 而本地运行才是ollama

### 可能方案

#### vllm

Deepseek官方文档提到vllm。

#### SGLang

Deepseek官方文档提到作为另一个方案。https://github.com/sgl-project/sglang

#### OLLAMA

国内公众号提到的很多，基本都是这个选项。https://ollama.com/library/deepseek-r1

#### unsloth

参考这篇 https://unsloth.ai/blog/deepseek-r1

#### OpenLLM

根据文档，支持deepseek-r1 https://github.com/bentoml/OpenLLM

#### skypilot

根据文档，支持deepseek-r1 https://docs.skypilot.co/en/latest/examples/models/deepseek-r1.html
