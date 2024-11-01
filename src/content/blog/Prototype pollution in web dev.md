---
author: W
featured: false
draft: false
description: web开发中的Prototype被污染问题的研究
pubDatetime: 2024-11-01T01:24:00Z
title: Prototype pollution in web dev
tags:
  - Angular
---

### 如何解决

先说如何解决，我们可以参考mdn这里提到的preventExtensions方法，https://developer.mozilla.org/zh-CN/docs/Web/JavaScript/Reference/Global_Objects/Object/preventExtensions 但是这个需要在一开始就操作，这个方法优于Object.freeze()和Object.seal()

另外还可以通过iframe来得到原始方法，“let originalMethod = iframe.contentWindow.whatYouWantToAccess; ”

### 关于zone.js注入的方法

这是我翻github发现的一个函数，正好跟这个主题关联起来了 https://github.com/DataDog/browser-sdk/blob/main/packages/core/src/tools/getZoneJsOriginalValue.ts 这个函数可以得到zonejs注入前原始的函数，其实zonejs就是把它们存入了window.Zone对象下面的**symbol**函数里面，然后通过browserWindow.Zone.**symbol**(functionName) 就可以拿回原始的函数了。

### 参考资料

https://kettanaito.com/blog/why-patching-globals-is-harmful
