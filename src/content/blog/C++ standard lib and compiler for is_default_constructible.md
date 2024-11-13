---
author: W
featured: false
draft: false
description: C++学习研究
pubDatetime: 2024-11-08T01:23:45Z
title: C++ Standard library and compiler research for is_default_constructible
tags:
  - cpp
---

### 问题

最近在看c++相关的内容，发现这个标准库函数 https://en.cppreference.com/w/cpp/types/is_default_constructible 它可以assert有没有默认构造器，我好奇它的内部实现，就查了一下，比如微软的STL是这样的 https://github.com/microsoft/STL/blob/main/stl/inc/type_traits ，GCC大概是这样的 https://github.com/gcc-mirror/gcc/blob/master/libstdc%2B%2B-v3/include/std/type_traits

问题来了，它们大概都用了类似\_\_is_constructible这样的内部函数或者结构，但是再往下就找不到了

### 研究

如果标准库没有结果，是不是这个东西是由更底层的内容，编译器来做的手脚呢，然后我们就用这个搜索词加上clang进行查询，在这里 https://github.com/microsoft/clang/blob/master/docs/LanguageExtensions.rst 能找到相关的内容，然后提到说“Type trait primitives”，那这又是什么？

这时候我们可以转用chatgpt，它给出的答案是这样的“Type Trait Primitives 是由编译器（如 Clang、GCC 和 MSVC）直接提供的内建特性。编译器在内部实现这些特性，并为标准库提供了一些基础支持，以便 C++ 标准库可以基于它们构建更复杂的类型特性。常见的 Type Trait Primitives 包括...”。到此为止我们就知道了，这个标准库特性是由编译器暴露出来一些属性，然后标准库来使用，缺一不可。

又是学到东西的一天。
