---
author: W
featured: false
draft: false
description: Angular的装饰器@component是如何工作的，从源代码开始学起
pubDatetime: 2024-11-01T00:22:00Z
title: How decorator @component work, how Angular compiler work
tags:
  - Angular
  - web
---

对Angular的代码比较感兴趣，读读源代码学习学习。

跟@component相关的Compiler的源代码在这里，这个类ComponentDecoratorHandler实现了DecoratorHandler https://github.com/angular/angular/blob/18.2.x/packages/compiler-cli/src/ngtsc/annotations/component/src/handler.ts 我们能看到NgCompiler class会调用makeCompilation()来创建ComponentDecoratorHandler。 https://github.com/angular/angular/blob/18.2.x/packages/compiler-cli/src/ngtsc/core/src/compiler.ts#L1215

analyzeSync()和analyzeAsync()会调用makeCompilation()函数。

我们在Angular Cli里面可以看到CompileFull / CompilePartial / CompileLocal 的调用 https://github.com/angular/angular/blob/18.2.x/packages/compiler-cli/src/ngtsc/transform/src/compilation.ts

### 参考资料

https://blog.angular.dev/how-the-angular-compiler-works-42111f9d2549

https://medium.com/angular-in-depth/a-deep-deep-deep-deep-deep-dive-into-the-angular-compiler-5379171ffb7a

https://angular.love/do-you-know-how-angular-transforms-your-code

https://insights.encora.com/insights/ahead-of-time-compilation-vs-just-in-time-compilation-part-1

https://angular.love/angular-ivy-change-detection-execution-are-you-prepared also refer to https://alexzuza.github.io/ivy-cd/ and https://alexzuza.github.io/ivy-jit-preview/ for animition view for change detection
