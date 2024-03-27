---
author: W
featured: false
draft: false
description: programming rules
pubDatetime: 2024-03-27T00:22:00Z
title: 程序设计原则
tags:
  - blog
---

YAGNI – You Aren’t Gonna Need It
https://en.wikipedia.org/wiki/You_aren%27t_gonna_need_it
https://martinfowler.com/bliki/Yagni.html
“Always implement things when you actually need them, never when you just foresee that you need them.”
“你不需要做这事”原则，但是也需要权衡短期就需要的灵活扩展可能性。
建议：对于需求之外的扩展，可以经过小组讨论决定是否需要。

Don’t repeat yourself
https://en.wikipedia.org/wiki/Don%27t_repeat_yourself
“别重复自己”原则。
通过自动化测试替代反复使用的手动测试。
通过设计模式，抽象，继承，重载，公用函数来减少代码重复。
提醒信号：再一再二，但不能再三再四。如果一件事，一段代码，一个需求，一个手动测试反复出现，就可以考虑应用DRY原则。

KISS – Keep it simple, stupid
https://en.wikipedia.org/wiki/KISS_principle
“保持简单”原则。
对于一个需求，如果有两种实现，一种较为简单，一种比较复杂，尽量选择简单的实现。
参考“奥卡姆剃刀” （https://zh.wikipedia.org/wiki/%E5%A5%A5%E5%8D%A1%E5%A7%86%E5%89%83%E5%88%80 ）

If it ain’t broke, don’t fix it
https://en.wikipedia.org/wiki/Bert_Lance#If_it_ain’t_broke,_don’t_fix_it
“没坏就不修”原则。
一个设计或者代码，虽然不够好，如果满足需求还能用就不要动它。
反例：如果新的开发要修改以前代码，可以考虑一起把不够好的部分修掉。
