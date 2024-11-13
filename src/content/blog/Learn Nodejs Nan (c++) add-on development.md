---
author: W
featured: false
draft: false
description: 通过读memwatch源码，学习如何用Nodejs Nan来开发一个内存监测库
pubDatetime: 2024-11-12T01:24:00Z
title: Nodejs Nan (C++) add-on development
tags:
  - Nodejs
---

### 为什么要用Nan

Node.js NAN（Native Abstractions for Node.js）是一个 C++ 框架，它提供了一套 API，让开发者可以更方便地编写 Node.js 的原生模块。那么，为什么我们要使用 NAN 来进行开发呢？

性能提升： 通过编写原生模块，可以将一些计算密集型或 I/O 密集型的任务从 JavaScript 转移到 C++ 执行，从而提高应用程序的性能。

#### NAN 的常见应用场景

高性能计算： 对于需要大量计算的场景，如图像处理、机器学习等，使用 NAN 可以充分利用 C++ 的性能优势。

底层系统调用： 当需要直接操作操作系统底层功能时，如文件系统操作、网络编程等，NAN 可以提供更底层的访问。

第三方库集成： 如果想要在 Node.js 中使用一些 C++ 编写的第三方库，NAN 可以帮助你将这些库集成到 Node.js 应用程序中。

### node-memwatch 源码学习

我也是随便翻airbnb的代码发现这个库，它可以侦测内存使用，发现内存泄漏。

打开这个目录https://github.com/airbnb/node-memwatch/tree/master/src 我们能看到Init.cpp这个代码，里面代码大概这样，我们能看到一个target参数，然后调用了HeapDiff和memwatch两个功能。

        extern "C" {
            void init (v8::Local<v8::Object> target)
            {
                Nan::HandleScope scope;
                heapdiff::HeapDiff::Initialize(target);

                Nan::SetMethod(target, "upon_gc", memwatch::upon_gc);
                Nan::SetMethod(target, "gc", memwatch::trigger_gc);

                Nan::AddGCPrologueCallback(memwatch::before_gc);
                Nan::AddGCEpilogueCallback(memwatch::after_gc);
            }

            NODE_MODULE(memwatch, init);
        };

那这里的Nan::SetMethod什么意思，通过chatgpt可知，我们可以粗略认为是在exports上添加了"upon_gc"还有"gc"这两个函数，它们内部实现就是后面跟着的memwatch对应的两个函数。

在https://github.com/airbnb/node-memwatch/blob/master/src/memwatch.cc 我们能看到AsyncMemwatchAfter这个函数，里面有这样代码，这也是为什么我们可以调用on('stats', ...)的原因。

        argv[0] = Nan::New("stats").ToLocalChecked();
        argv[1] = stats;
        uponGCCallback->Call(2, argv);

这里我有一个小问题，虽然sample里面有一个“leak”事件，但是我在代码中，以及它自身的测试集当中没有看到这个leak相关的信息。

另外我们能看到info这个变量，这也是Nan文档写的不清晰的地方，这个可以认为是输入参数数组（类似c语言argv），但是这个名字太迷惑人了。

另外通过阅读代码我们能看到，Nan可以直接和V8内核进行交互，虽然有这个https://nodejs.org/api/v8.html 标准API，但是提供的功能丰富程度没法和Nan相比。

如何从Nan里面发出一个event给调用者（nodejs的javascript代码），可以参考我这里问Gemini的问题 https://g.co/gemini/share/10103f8a8d2a

另外如果我们用Rust语言来写，可以用这个基础库 https://github.com/napi-rs/

### 参考资料

https://github.com/airbnb/node-memwatch

https://github.com/nodejs/nan

https://nodejs.org/api/v8.html

https://github.com/nodejs/node-addon-examples

https://github.com/napi-rs/
