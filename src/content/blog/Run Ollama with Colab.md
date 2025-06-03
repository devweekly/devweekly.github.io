---
author: W
featured: false
draft: false
description: How to run ollama in Google Colab
pubDatetime: 2025-06-02T02:02:03Z
title: Run Ollama with Google colab
tags:
  - blog
---

According to this document: https://medium.com/google-cloud/gemma-3-ollama-on-colab-a-developers-quickstart-7bbf93ab8fef

It is necessary first step to install some packages:

```
! sudo apt update && sudo apt install pciutils lshw
```

Then normal Ollama installation and running steps as below:

```
!curl -fsSL https://ollama.com/install.sh | sh

!nohup ollama serve > ollama.log 2>&1 &

! ollama run gemma3:12b “What is the capital of the Netherlands?”
```
