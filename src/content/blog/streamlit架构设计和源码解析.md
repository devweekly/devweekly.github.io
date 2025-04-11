---
author: W
featured: false
draft: false
description: code reading
pubDatetime: 2025-04-11T01:23:45Z
title: streamlit架构设计和源码解析
tags:
  - blog
---

streamlit的源代码在这里 https://github.com/streamlit/streamlit

如何实现的Python代码驱动web页面运行？

并不是用webassembly，类似于pyodide这样的。实际上是实现了一个服务器端解析Python代码，然后在web端解析成相对应的web component，所以我们能看到这个目录 https://github.com/streamlit/streamlit/tree/develop/proto/streamlit/proto 这就是服务器端和客户端需要满足的协议。消息使用的协议是protobuf，客户端的连接管理可以参考https://github.com/streamlit/streamlit/blob/develop/frontend/app/src/App.tsx#L126 通信协议实际上是websocket。

在服务器端，当解析代码遇见一个组件，比如PlotlyChart，在服务器端它会寻找这个https://github.com/streamlit/streamlit/blob/develop/lib/streamlit/elements/plotly_chart.py 然后在浏览器端就会寻找 https://github.com/streamlit/streamlit/blob/develop/frontend/lib/src/components/elements/PlotlyChart/index.ts

在这个runtime里面，有关键的代码 https://github.com/streamlit/streamlit/tree/develop/lib/streamlit/runtime 比如scriptruner，再比如很重要的runtime.py
