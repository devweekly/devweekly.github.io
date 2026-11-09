# 长期主线规划

长期主线与章节状态分开管理。

- `story-plan.json`：作者确认的未来方向，包括核心构想、核心矛盾、主角长期目标、失败代价、最终方向、关键节点、长期剧情线、揭示方向、约束和未决问题。
- `story-state.json` / SQLite `story_state`：已经发生的事实、人物当前状态、事件和当前情节线状态。
- `story_analysis`：从原始语料提取的分析参考，不是正史，也不是必须执行的剧情指令。
- `novel_plot_threads`：原文中识别出的剧情线证据，不等同于项目未来规划。

## 建立候选主线

在 `tools/novel-generation` 目录运行：

```bash
npm run dev -- plan-story --world <world-id>
```

命令结合世界设定、当前故事状态和已有的全书语料分析，生成候选规划，写入 `.output/<world-id>/story-plan-candidate-*.json`。候选默认为 draft，不会进入章节生成上下文。审阅后通过候选文件路径激活：

```bash
npm run dev -- plan-story --world <world-id> --activate-candidate .output/<world-id>/story-plan-candidate-<timestamp>.json
```

正式规划保存为 `worlds/<world-id>/story-plan.json`。如果希望跳过候选审阅，也可直接用 `--activate` 在生成时启用。普通章节和长章节会自动读取它。

## 规划原则

主线规定故事长期方向，不固定未来每章的事件、场景和对白。卷级故事、阶段剧情和单元故事可以形成局部闭环；不是每章都要显式推进主线。

主线是对未来的规划，Story State 是已发生事实。发生冲突时以事实为准，不允许为了迁就旧大纲而改写既成剧情。完成一卷或发生重大转折后，可以重新运行命令生成候选修订；审阅后再激活。当前实现不会由章节 Agent 自动改写正式主线，也不会自动将规划节点标记为已完成。
