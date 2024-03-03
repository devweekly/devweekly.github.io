---
title: Multithreading in nodejs
pubDatetime: 2023-08-02T12:22:00Z
tags:
  - tech
author: W
featured: true
draft: false
description:
  tech weekly
---

![title image](https://images.unsplash.com/photo-1690736159167-b00621eba9f6?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=687&q=80)

事情的起源是有人提到Nodejs是单线程的，对于某某场景的性能支持有问题，应该使用Java。

那这里面一部分是有道理的，但也有比较大的认知错误。先不论Nodejs的线程模型，单说在某某场景下调用后端服务，Java就比Nodejs性能好，这点我肯定是不同意的；退一万步，就算nodejs比Java性能要差，但是Nodejs和前端Angular也好其它web框架也罢，开发者体验和前后端整合能力肯定要更强的。

回到Nodejs单线程问题上，首先一点，Nodejs不是单纯的单线程，如果仅仅谈论JavaScript或者TypeScript，没有任何跟线程线程相关的内置语言特性（比如Thread）。

[node_worker.cc source code](https://github.com/nodejs/node/blob/main/src/node_worker.cc)

[ ]()
