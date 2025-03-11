---
author: W
featured: false
draft: false
description: Software architecture diagramming tool
pubDatetime: 2025-03-10T01:23:45Z
title: Architecture diagramming tool comparing
tags:
  - architecture
---

### DSL to diagramming

https://plantuml.com/ I would recommend PlantUML as top 1, normally it is used to generated sequence diagram. It seems like we could use Activity diagram to generate decisition tree type diagram.

https://mermaid.js.org/ Many AI diagramming generation tool integrated with Mermaid.js as backend to generate code and render diagram. It supports rich types of diagramming graph.

### Others

https://www.drawio.com/ used to generate C4 diagramming, but "code to diagramming" would be difficult to support in Drawio because its syntax is complex.

### Chart, but not diagramming

We may leverage some chart library to render data to show as architecture diagramming.

https://echarts.apache.org ECharts from Baidu

https://github.com/antvis Ant Vision from Alibaba

https://www.visactor.io/ VisActor from ByteDance

https://d3js.org/ D3 would be a choice for real time dashboard for architecture, for example this case https://github.com/julie-ng/newtonjs-graph

https://c3js.org/ C3 make D3 easier to use.
