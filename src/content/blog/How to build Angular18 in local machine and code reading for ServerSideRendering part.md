---
author: W
featured: false
draft: false
description: 本地编译和调试Angular18，学习Angular的SSR代码
pubDatetime: 2024-11-01T00:22:00Z
title: Local build Angular18 and code reading Ng ServerSideRendering
tags:
  - Angular
---

对Angular的Server Side Rendering （SSR）比较感兴趣，在本地读读源代码学习学习。

SSR部分代码在这里 https://github.com/angular/angular-cli/tree/main/packages/angular/ssr 并不是和主要的代码在一起，我也花了一点点时间找到这部分。

不过我们先看如何在本地编译Angular 主要部分的代码，主要参考这里 https://github.com/angular/angular/blob/main/contributing-docs/building-and-testing-angular.md 需要注意的是本地安装的nodejs版本需要跟.nvmrc符合（我用的macbook），比如Angular18当前设定的是18.20.0版本，用nvm切换到这个版本，然后yarn安装就好了。另外一个需要注意的是，如果和实际Angular项目一起debug，那么clone下来的应该是项目指定的Angular版本，不要有差别。

如果Bazel编译没问题，那么我们根据这一步 “Building and serving a project”就可以把我们build好的Angular和实际项目关联起来了。

同样的，针对Angular Cli，根据这个文档 https://github.com/angular/angular-cli/blob/main/docs/DEVELOPER.md 一步步照做就好了。

### code reading

如果我们看SSR相关的Angular代码，会发现使用了platform-server相关的package，在platform-server里面有renderApplication和renderModule函数，而这两个函数会调用\_render()函数，这个函数在这里 https://github.com/angular/angular/blob/18.2.x/packages/platform-server/src/utils.ts

在Angular Cli里面有一个CommonEngine，有类似render()和retrieveSSGPage()这样的函数，从angular v17开始就不依赖于express了。https://github.com/angular/angular-cli/blob/18.2.x/packages/angular/ssr/src/common-engine.ts 这几个函数会在服务器端生成和返回html，另外使用了critters用于inline css的处理。

#### Angular Domino

Angular Domino是什么？ 如果我们看Angular本身，它依赖于一个叫Domino的包（https://github.com/angular/domino），主要就是用于解决Server Side Rendering的问题，支持DOM Level4 api和在服务器端Mock DOM对象（其它支持SSR的也有类似package，比如https://github.com/ionic-team/stencil/tree/main/src/mock-doc ）在Qwik里面，它是这个包 https://github.com/QwikDev/qwik/tree/main/packages/qwik-dom
