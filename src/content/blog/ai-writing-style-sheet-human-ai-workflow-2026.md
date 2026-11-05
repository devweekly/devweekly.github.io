---
author: SW
pubDatetime: 2026-11-04T08:00:00Z
title: "AI 写作的关键不是 Prompt：Style Sheet、作者声音与人机协作工作流"
featured: false
draft: false
tags:
  - AI
  - Generative AI
  - AI Writing
  - Prompt Engineering
  - Context Engineering
  - Human-AI Collaboration
  - Writing
  - Fiction Writing
  - Long-form Generation
  - Narrative Consistency
description: "从 Coral Hart 的 AMA 出发，结合 ACL、PNAS 等研究、编辑团队实践和长篇叙事研究，拆解 Style Sheet、作者声音、AI 写作痕迹，以及小说续写中的 Story Bible、Narrative State 与场景级工作流。"
---

# AI 写作的关键不是 Prompt：Style Sheet、作者声音与人机协作工作流

**研究截止日期：2026 年 11 月 5 日**

## 写作风格不是一句 Prompt 能描述清楚的

2026 年 3 月，作家 Coral Hart 在 Reddit 的 r/WritingWithAI 做了一场 AMA。她谈到自己使用 Claude 辅助创作的流程：在生成正文前，先准备 style sheet、craft bible、codex、character sheets、world building、beat sheets 和 outline；写作过程中使用这些材料约束模型，之后仍然亲自阅读和编辑。

有人问她如何处理 Claude 常见的华丽措辞、重复句式和所谓的 AI-isms。她的回答很直接：先用 style sheet 提供写作技巧约束，例如降低感官描写的密度、提醒模型遵循 Show, Don't Tell；生成之后，她还会删掉大量不需要的内容。面对重复结构，她会使用 style sheet、避免只靠否定式 Prompt，并通过 clean-up 提示调整句子。她也明确说过，模型不能稳定地写出作者本人的声音，作者需要在编辑时把自己的声音放回文本。

这场 AMA 值得关注的地方，不是她一年写了多少本书，也不是她的商业模式是否适合其他作者，而是她把 AI 写作从“给模型一个题目，让它写一篇文章”变成了一个有准备、有约束、有编辑环节的生产过程。她声称的产量和质量并没有经过独立审计，不能当作普遍生产力数据；但她描述的工作方法，可以和其他作者、编辑团队的经验以及学术研究相互参照。

本文讨论的 Style Sheet，中文可以叫写作风格规范表。它不是一段万能 Prompt，也不是禁用词清单，而是把作者或组织对语言、叙述、结构和编辑质量的要求整理成一份可复用的工作规范。它需要和真实写作样本、内容资料、编辑流程一起使用。

## 为什么 AI 写出来的东西经常“正确，但不像人写的”

AI 文本的问题往往不在语法。句子可能通顺，段落也完整，甚至比原稿更整齐；读起来却容易显得过度解释、修饰过多、节奏单一，缺少作者在真实写作中形成的取舍。

这并不只是读者的主观印象。Reinhart 等人在 2025 年发表于 PNAS 的研究《[Do LLMs write like humans? Variation in grammatical and rhetorical styles](https://doi.org/10.1073/pnas.2422455122)》，比较了 12,000 份人类文本与 GPT-4o、Llama 3 等模型生成的文本。研究覆盖口语转录、新闻、杂志和学术写作等不同体裁。作者发现，指令微调模型有明显的语言结构偏好：更偏向信息密集、名词化的表达，某些分词结构和名词化结构出现频率明显高于人类文本。即使 Prompt 要求模型模仿原文风格，这些差异仍然存在；更大的模型也没有自动消除这种风格差异。

研究还观察到一些高频词偏好。例如 GPT-4o 输出中的 *tapestry*、*palpable*、*amidst* 等词，在所比较的人类语料中出现得少得多。问题不在于这些词不能使用，而在于模型可能把它们带入不合适的体裁，或在多个段落里反复使用。小说中的修辞不一定适合技术说明，学术文本的正式语气也不一定适合个人随笔。

这项研究使用的是特定模型和英语语料，不能直接推出中文模型具有完全相同的词汇偏好。但它说明了一个重要问题：模型的默认写作风格并不是中性的。指令微调会形成某些稳定的表达倾向，而用户只说“自然一点”“像人写的”，不足以明确告诉模型应该改变什么。

## Style Sheet 应该写什么

Style Sheet 的任务是把“我喜欢什么样的文字”转化成模型能理解、作者能检查的具体约束。它描述的不是某个主题，而是文本应该如何表达。

一份可用的 Style Sheet 通常会覆盖叙述视角、语气、句子节奏、段落组织、词汇选择、修辞习惯、信息密度、对话方式，以及需要避免的表达模式。小说可能需要约束 POV、时态、叙述距离、人物声音和感官描写；技术文章则更关心术语准确性、论证方式、证据限定、代码和示例的使用，以及是否存在空洞的总结句。

例如，“写得简洁、自然、有技术深度”仍然太抽象。可以将它改写为更容易执行的规则：

- 先说明具体对象和行为，再解释抽象概念；不要连续堆叠名词。
- 结论必须对应可核验的事实、实验或来源；没有证据时明确写出推断边界。
- 段落围绕一个完整论点展开，不要把连续论述拆成逐句短段。
- 不要为了显得完整，在每节末尾重复本节已经说明的结论。
- 删除没有信息增量的修饰词和连接词；保留表达因果、转折、时间和适用范围所必需的词。
- 不要为了追求“文学性”而添加比喻、感官细节或情绪判断。

这些规则不是固定模板。技术文章不需要人物对话规则，小说也不需要强制使用技术报告的证据表格。Style Sheet 应根据写作类型和作者自己的样本建立，而不是从一份通用的“人类写作提示词”复制过来。

规则最好同时说明正向要求和反例。只写“不要使用华丽语言”，模型并不知道作者认可的表达是什么；提供一段作者认可的文字，再解释它为什么合适，通常更有信息量。规则也应有优先级：事实准确、作者原意和上下文一致性不能为了满足句式偏好而牺牲。某个词不应该因为被列入观察清单，就在所有语境中被机械替换。

## 规则之外，更重要的是作者自己的样本

2026 年 9 月，写作者 Sunny Sink 分享了一个很实用的做法：[Stop Writing Rules for Your AI](https://sacredvision.substack.com/p/stop-writing-rules-for-your-ai)。她发现自己的 voice 文件里堆满了规则，却仍然无法让 Claude 稳定地写出自己的声音。后来她改为让模型一次生成 12 段短文，由作者标记哪些段落符合自己的表达、哪些勉强可以、哪些完全不接受；如果没有一段合适，就亲自改写其中一段。几轮之后，把认可的样本和手工改写的版本保存成一个文件，要求模型在后续写作前读取。

这是一篇作者经验分享，不是控制实验，但它指出了风格描述的一个实际难点：人通常能判断“这句话像我”或“这句话不像我”，却未必能准确说出差异在哪里。作者亲自改写的段落往往比“更自然”“更有力量”这类形容词更有用，因为它展示了具体的词汇、句长、停顿和信息组织方式。

2025 年 EMNLP Findings 的论文《[Catch Me If You Can? Not Yet: LLMs Still Struggle to Imitate the Implicit Writing Styles of Everyday Authors](https://aclanthology.org/2025.findings-emnlp.532/)》也说明了少量样本的局限。研究评估了 400 多位真实作者，覆盖新闻、邮件、论坛和博客，累计生成超过 40,000 份文本。模型在新闻、邮件等结构相对明确的体裁中可以接近作者风格，但在博客和论坛这种更依赖隐性习惯、语气和个人表达的文本中，模仿效果明显更差。作者指出，个人风格有大量难以通过几条 Prompt 明确描述的隐性特征。

因此，建立个人风格资料时，不要只收集“写得好的文章”。最好选取不同场景下仍然能代表作者的样本：解释概念时怎么写，表达不同意见时怎么写，描述经历时怎么写，如何承认不确定性，如何使用例子。每个样本可以附一两句说明，指出值得保留的特征。负面样本也有价值，但不要只存一张禁用词表。

## 从个人 Style Sheet 到编辑团队的 Editorial Style Guide

Style Sheet 并不只适用于小说作者。卡内基梅隆大学 Computing Services 团队在 2024 年分享过一个 AI 内容生产案例：[Fine-Tuning Generative AI for Content Creation](https://www.cmu.edu/computing/news/2024/ai-correspondent/ai-daily-correspondent.html)。

团队最初发现，普通 Prompt 无法让生成稿符合组织需要的语气和质量，编辑人员花在修改 AI 初稿上的时间甚至可能超过直接写作。后来，他们把一篇 AI 初稿和对应的人类编辑终稿放在一起，让模型分析两者在风格和语气上的差异，提炼出清晰、简洁、主动语态、适合网页阅读等编辑原则，再将这些原则固化到一个定制 GPT 中。团队报告称，后续初稿更接近编辑标准，返工时间减少。

这里值得借鉴的是方法，而不是“定制 GPT”这个产品形式。团队不是凭空写了一份风格规范，而是从真实的初稿和终稿差异中提取规则。相同方法可以用于企业技术博客、产品文档、内部研究报告和客户沟通材料：找出几组有代表性的原稿与编辑稿，识别编辑反复做的改动，再把稳定的判断写成规则。

组织级 Editorial Style Guide 和个人 Style Sheet 有重叠，但目标不完全相同。前者强调品牌语气、术语、受众、事实来源、格式和合规要求；后者更关注作者个人的表达习惯。团队可以有统一的编辑规范，同时允许不同作者保留自己的句子节奏和表达方式。否则，所谓统一风格很容易退化成所有人都写成同一种 AI 腔调。

## AI 写作研究给出的另一个提醒：润色不等于找回作者声音

2026 年 ACL 论文《[Can You Make It Sound Like You? Post-Editing LLM-Generated Text for Personal Style](https://aclanthology.org/2026.acl-long.2030/)》通过一项预注册在线研究，让 81 名参与者编辑模型生成的文本。结果显示，人工编辑确实提高了文本与作者独立写作样本之间的风格相似度，也降低了它与纯模型文本的相似度；但编辑后的文本整体仍然更接近模型文本，而不是作者在没有 AI 帮助时写出的文本，风格多样性也更低。参与者主观上认为文本已经有自己的风格，与模型测量到的风格相似度之间还存在差距。

这意味着“让 AI 先写，再让 AI 自己润色”并不能可靠地消除模型风格。即使由人来编辑，也可能在不知不觉中保留模型的句子组织方式。真正有效的编辑需要作者对内容和表达作出判断，而不是只检查错别字或让模型再执行一次“humanize”。

2025 年一项针对研究生专业写作的研究则给出了效率方面的另一面：[Generative AI’s Impact on Graduate Student Professional Writing Productivity and Quality](https://link.springer.com/article/10.1007/s40593-025-00528-z)。在提供针对性 AI 使用教学后，研究中的学生完成写作任务的中位时间从 150 分钟降到 65 分钟，评分也从 A- 提高到 A。这个结果支持 AI 在特定专业写作任务中的效率价值，但实验对象、任务和教学条件都有边界，不能据此推断所有写作类型都能获得同样收益。

两类结果并不矛盾。AI 可以减少资料整理、初稿组织和语言修改的时间，却不意味着它自动掌握作者的表达习惯，也不意味着生成文本已经达到可以直接交付的质量。效率提升和作者声音保留，是两项需要分别设计、分别验证的目标。

## 可以直接使用的开源项目和商业产品

Style Sheet 已经不只是作者自己维护的 Markdown 文件。开源社区里出现了几类工具：把写作规范变成可执行检查、从历史文本中提取个人风格、把风格规范封装成 Agent Skill，以及在写作过程中做 AI 痕迹审查。商业产品则更多面向企业品牌一致性和内容治理。它们解决的问题不同，不宜都归为“AI Humanizer”。

### 开源项目：从规范检查到个人声音建模

| 项目 | 主要用途 | 适合的场景 | 需要注意 |
| --- | --- | --- | --- |
| [Vale](https://github.com/vale-cli/vale) | 可配置的 prose linter，把风格指南、术语和用词规则变成命令行检查，可集成编辑器和 CI | 技术文档、产品文档、企业 Editorial Style Guide | 它主要检查规则是否一致，不负责生成内容，也不会自动理解作者完整的个人声音 |
| [human-writing](https://github.com/KKKKhazix/human-writing) | 面向中文写作的 Agent Skill，提供写作和改稿流程，目标是减少通用 AI 表达 | 中文文章、内容改写、Agent 工作流 | 属于 Skill 和规则/流程集合，不是独立编辑器；应检查其规则是否适合自己的文体，避免把“去 AI 味”变成统一模板 |
| [Write Like Me](https://github.com/HopLittleBunny/write-like-me) | 从作者样本或回答中学习可携带的写作模式，审查和改写文本，并用语义保护约束改动 | 个人作者希望保留原意、学习个人表达习惯 | 项目明确区分含义、作者决策、文本质感和声音；其 README 描述的是项目设计能力，不等于已经有独立研究证明风格匹配效果 |
| [write-like-me-mcp](https://github.com/gwicho38/write-like-me-mcp) | 本地 MCP 服务，从个人文档语料提取句长、词汇、标点等统计特征，并检索真实写作片段供 Agent 使用 | 希望把个人风格资料接入 Claude 等 MCP 客户端，同时让语料留在本机 | README 所述 v0.1 不调用 LLM，负责提供风格上下文，实际写作仍由调用它的模型完成；检索出的样本若被发送给云端模型，仍会离开本机 |
| [House Style System](https://github.com/kalensr/house-style-system) | House Style 文档、Vale 检查门禁、示例夹具和可选 AI 声音审查/eval 脚本 | 团队想把写作规范、自动检查和发布前评审组合起来 | 它是一个可借鉴的轻量工作流样板，不是通用 SaaS；部分声音审查层是可选的，需按自己的规范调整 |
| [The Style Guide](https://github.com/cote/the-style-guide) | 将多套命名风格封装为可移植的 Claude Skill，按任务加载不同风格和反模式参考 | 多作者、多内容类型，或需要在不同作者声音之间切换 | 默认示例风格不等于你的风格；需要替换为自己有权使用的样本和规范 |
| [nabokov](https://github.com/viewflow/nabokov) | 命令行英文 prose linter，检查可读性、冗长表达、被动语态，并提供可选 AI 写作痕迹检查 | 英文稿件的快速质量扫描和 CI 检查 | AI 痕迹规则只能作为审阅提示，不能判断作者身份，也不能证明文本是否由 AI 生成 |

这些项目可以按职责组合，而不是选一个“全能工具”。例如，先用个人样本建立 Voice Profile，再把稳定的术语、格式和禁用模式整理成 Style Sheet；写作 Agent 读取前两者起草和编辑，Vale 或其他 linter 在提交或发布前检查确定性规则。对于中文内容，可以试用 human-writing；对于本地语料和隐私要求较高的个人写作，可以研究 write-like-me-mcp；对于团队文档治理，Vale 和 House Style System 更接近工程化落地。

其中 Vale 的价值尤其容易被低估：风格规范如果只存在于 Prompt 或团队 Wiki 中，执行依赖每个人记得加载；转成可运行规则后，术语、大小写、冗长表达和格式要求就能在编辑器或 CI 中持续检查。反过来，Vale 也不应该承担它做不到的事——它不能判断论点是否有价值，也不能替作者判断某段文字是否真正像自己。

### 商业产品：面向组织的 Brand Voice 和 Style Governance

| 产品 | 官方提供的相关能力 | 主要定位 |
| --- | --- | --- |
| [WRITER](https://writer.com/brand/) | 定义团队或品牌的 Voice、批准用语、写作规则，并在生成和审阅流程中应用 | 企业级品牌内容治理，把语言规范、知识和工作流整合到生成过程 |
| [Grammarly Pro / Enterprise](https://www.grammarly.com/business/styleguide) | 上传组织 Style Guide、配置写作规则和 Brand Tones，在 Grammarly 支持的写作环境中提供上下文建议 | 跨应用的写作一致性、语言质量和品牌语气管理 |
| [Jasper](https://help.jasper.ai/hc/en-us/articles/55085068545819-Jasper-IQ) | Jasper IQ 组合 Brand Voice、Audiences、Knowledge Base、Style Guide、Visual Guidelines 和 Product IQ；Style Guide 可在生成时自动应用 | 面向营销团队的多品牌、多受众内容生产和品牌治理 |

商业产品的共同点是把规范从“事后检查”前移到“生成时约束”。Jasper 的官方文档还明确区分了 Brand Voice（品牌如何表达）、Audience（面向谁）、Style Guide（词汇、标点和格式规则）、Knowledge（经批准的事实和声明）以及 Agent Instructions（本次任务要做什么）。这种职责划分值得借鉴：不要把所有背景、规则和任务要求塞进一个越来越长的 Prompt。

产品边界也要看清。WRITER、Grammarly 和 Jasper 的主要目标是组织或品牌一致性，不等于能完整复现某位作者的个人写作习惯。企业品牌声音强调跨作者统一；个人 Voice Profile 强调保留作者之间的差异。两者可以共存，但不应混为一谈。商业产品的功能和套餐会变化，采购前应以官方当前计划、数据处理条款、模型训练政策、保留期限和集成方式为准。

### 怎么选：按要解决的问题组合

- **个人作者，希望 AI 写得更像自己：** 从真实样本开始，优先尝试 Write Like Me 或 write-like-me-mcp 这类个人风格工具；保留作者确认的修改记录，逐步形成 Voice Profile。不要只依赖“像某某作家”的模糊指令。
- **中文内容，希望减少通用 AI 腔调：** 可以评估 human-writing 的 Skill 和规则，但要用自己的文章做对照测试，重点检查是否保留原意、限定条件和作者习惯。
- **技术文档或团队知识库：** 用 Vale 将术语、大小写、冗长表达和格式要求自动化；House Style System 展示了如何把规范、测试夹具和发布前审查串起来。
- **多作者企业内容：** 评估 WRITER、Grammarly 或 Jasper 的品牌规范、权限、知识管理和生成时约束能力；重点不是生成文案的演示效果，而是能否进入现有编辑、审批和合规流程。
- **小说和长篇创作：** 通用 prose linter 只能检查语言表层。人物声音、叙事视角、时间线、世界观和情节连续性仍需要独立的 Craft Bible、Character Sheet、Codex 和人工编辑流程。

选型时至少做一轮自己的对照评估：准备同一组任务和作者样本，比较默认模型、加入文字规范、加入规范与样本、加入规范与样本再经过工具检查这几种条件。记录人工修改量、原意偏移、事实错误、风格匹配度和完成时间。项目 README 中的功能说明、产品官网上的案例和市场宣传都不能代替这项验证。

## 写作流程应该按阶段分配 AI 的权限

AI 写作工具经常把所有事情放进一个对话框：用户给主题，模型给全文，用户再说“改得更好”。这种交互把选题、构思、组织、起草、编辑和事实核验混在一起，模型很容易在用户只要求改语言时顺手改变观点，也容易在缺少内容资料时补出看似合理的新内容。

Reza 等人在 2025 年发表的研究《[Co-Writing with AI, on Human Terms](https://arxiv.org/abs/2504.12488)》系统回顾了 109 篇人机协作写作相关的 HCI 论文，并访谈了 15 位不同领域的写作者。研究将写作支持归纳为结构化指导、引导式探索、主动共同写作和批判性反馈，并把它们映射到计划、语言表达、审阅和过程监控等环节。研究发现，不同作者对 AI 介入程度的偏好并不相同：重视内容和论点的写作者，往往希望在规划阶段保留主导权；更重视语言形式的写作者，则特别在意表达和修改阶段的控制权。

Tim Kao 在 2026 年 10 月分享的个人写作框架《[How I Intend to Use AI in My Writing](https://timkao.substack.com/p/how-i-intend-to-use-ai-in-my-writing)》提出了一个相近的实践原则：只使用足以完成沟通目的的最低程度 AI 干预。他把辅助程度分为清理转录、保留声音的编辑、发展性编辑、AI 大量参与起草、AI 作为叙述者，以及人机共同探索新观点等层次。对他而言，公开发表的个人文章通常以保留原有表达的编辑为默认；如果模型提出了新的实质观点，应该先作为讨论材料交给作者，而不是未经作者消化就写进第一人称文章。

这套分级不是行业标准，但适合用来设计工作流。可以把写作过程拆成几个阶段，并明确每个阶段允许模型做什么：

**选题与构思。** AI 可以协助检索资料、提出问题、列出反例和比较不同观点。涉及作者立场、亲身经历和核心判断时，应由作者确认。模型提出的新观点先放在讨论区，不要直接混入作者原稿。

**资料整理与大纲。** AI 可以归纳来源、整理证据、提出章节顺序和发现论证缺口。事实、数据、引用和来源必须可追溯；大纲中的关键结论应能找到对应证据。长篇创作还需要维护人物、世界观、情节线索和章节节奏等资料。

**初稿生成。** 给模型提供任务说明、必要的事实材料、目标读者、Style Sheet 和结构约束。可以按章节或论证单元生成，避免一次性生成过长内容后再整体返工。初稿的目标是形成可编辑的内容，不是直接达到发布标准。

**内容编辑。** 检查论点是否成立、结构是否合理、例子是否支撑结论、人物和事实是否前后一致。小说需要检查人物动机、情节因果和伏笔；技术文章需要检查概念边界、实现条件、数据和来源。这个阶段不应该只做语言润色。

**语言编辑。** 根据 Style Sheet 调整句子、段落、术语、节奏和语气。优先保留作者原有表达，只修改确实影响准确性、可读性或风格一致性的部分。不要把所有句子都改得更圆滑、更正式。

**最终核验。** 对新增事实、数字、引用、因果关系和限定条件逐项回查。模型自我审稿不能代替独立核验；语言流畅也不能作为事实正确的证据。

## AI 长篇小说创作与续写：从 Style Sheet 到 Narrative State

前面的工作流适用于文章、报告和一般内容创作，但长篇小说还有一个不同的问题：模型不仅要知道“应该怎么写”，还要持续记住“故事已经发生了什么”。人物会获得或失去信息，关系会变化，物品会转移，人物会离开某个地点，伏笔会被解决，也可能被长期搁置。只保存章节摘要，无法可靠表达这些变化。

因此，长篇小说需要在 Style Sheet 之外增加一组叙事资料和状态管理机制。可以把它概括为三个问题：

- **Style Sheet / Voice Profile：** 用什么方式写，叙述者和人物分别如何表达。
- **Story Bible：** 故事世界里有哪些人物、地点、规则和已经确立的背景资料。
- **Narrative State：** 到当前章节为止，发生了什么变化；人物知道什么、不知道什么；哪些情节仍未解决。

这不是把 Prompt 写得更长，而是把创作依据从一段上下文拆成可以检索、更新和核验的资料。

### 业界产品已经采用了哪些做法

面向小说作者的产品，已经把部分能力做成了可操作的创作工作区。它们不是长篇叙事一致性问题的完整答案，但有一些值得借鉴的设计。

**Sudowrite：Story Bible 和 Chapter Continuity。** Sudowrite 的 Story Bible 汇集故事梗概、类型、风格、人物、世界设定和大纲等资料；Chapter Continuity 则让作者把文档按前后关系关联起来，在 Write 或 Draft 时提供相关前文。它把“从现有文字继续写”和“根据场景规划起草”区分开来，避免所有任务都依赖同一个自由对话框。参考：[What is Story Bible](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC)、[Chapter Continuity](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/chapter-continuity/4KL8gFeLZQ6GSBjDWtSbV6)。

**Novelcrafter：Codex。** Novelcrafter 的 Codex 更像一套与正文关联的故事 Wiki，可以维护人物、地点、物品、设定和情节线索，并在写作具体章节或场景时选择相关条目作为上下文。它的价值在于：资料可以长期保存，但每次生成只取当前任务真正相关的部分。参考：[Novelcrafter Codex](https://www.novelcrafter.com/features/codex)。

两种产品都体现了一个共同原则：**长期资料与当前写作上下文分离。** 不要每次把整本小说全部塞给模型，也不要指望模型从一份总摘要中准确还原所有细节。应该维护可查询的资料，再按当前章节和场景组装上下文。

### 研究关注点：长篇生成的核心风险是连续性错误

2026 年 ACL Findings 论文《[Lost in Stories: Consistency Bugs in Long Story Generation by LLMs](https://aclanthology.org/2026.findings-acl.410/)》提出 ConStory-Bench，用 2,000 个 Prompt、四类任务场景和五大类、19 个细分错误类型评估长篇故事一致性，并提出 ConStory-Checker，让检测结果对应到具体文本证据。论文发现，事实跟踪和时间维度的错误尤其突出，错误在故事中段更常见，不同类型的错误还可能同时出现。项目提供了[论文](https://aclanthology.org/2026.findings-acl.410/)、[代码](https://github.com/Picrew/ConStory-Bench)和[项目主页](https://picrew.github.io/constory-bench.github.io/)。

这项研究提醒我们：故事读起来流畅，不代表故事内部没有矛盾。常见问题包括人物已经离开或死亡却再次出现、人物提前知道尚未获知的秘密、物品在没有交代的情况下改变归属、时间顺序冲突，以及世界规则在后文悄悄改变。审核必须回到前后文证据，而不是只让模型给整章打一个“连贯性分数”。

另一项 2026 年 Findings of EMNLP 研究《[ConWriter: Transition-Constrained Stateful Long-Form Story Generation with Lightweight Neuro-Symbolic Consistency Control](https://aclanthology.org/2026.findings-emnlp.359/)》把生成过程组织成受状态转移约束的场景级写作，并结合轻量的符号化一致性控制。它的思路不是先写完一整章再统一找错，而是在场景推进过程中检查状态变化是否符合约束。论文和[实现代码](https://github.com/jindongli-Ai/ConWriter)可供进一步研究。

《[Scaling Long-Form Story Generation via Narrative State Tracking](https://arxiv.org/abs/2609.35759)》提出 NstAgent，将叙事状态拆为人物状态、过去事件和未来要求，并在章节生成后更新状态。作者报告了在更长故事上的一致性和质量实验结果。需要注意，这是一篇 arXiv 预印本，页面标注 Under review，不能把它当作已经经过同行评审的定论；但其状态表示方式具有直接的工程参考价值。

这些研究共同指向一个设计方向：**章节生成不是孤立的文本任务，而是对故事状态的一次受约束的转移。**

### 把 Story Bible 和 Narrative State 分开维护

建议至少区分以下几类资料。初期用 Markdown、JSON 和章节文件就能实现，不需要先引入图数据库或复杂知识平台。

| 资料 | 保存什么 | 变化方式 |
| --- | --- | --- |
| Canon / Source Facts | 原作或项目明确确立的事实、来源版本和证据位置 | 默认只读；发现版本差异时显式标注 |
| Style Sheet / Voice Profile | 叙述视角、语言节奏、人物声音、正反样本 | 经编辑验证后更新 |
| Story Bible / Codex | 人物背景、地点、物品、世界规则、关系定义 | 随新资料补充，避免与当前状态混为一谈 |
| Narrative State | 人物当前地点、身体状况、知识、目标、关系和持有物 | 每个场景结束后更新 |
| Event Ledger | 已发生事件、参与者、时间、地点、因果和证据章节 | 新事件发生时追加，不覆盖历史 |
| Plot Requirements | 伏笔、承诺、未解问题、后续必须回应的情节 | 标记 open、resolved、deferred 或 invalidated |
| Draft State | 当前草稿中暂时引入、尚未确认的设定和变化 | 审核通过后才能写入正式状态 |

这里最重要的是区分 **Canon** 和 **Narrative State**。Canon 是故事依据，Narrative State 是故事进行到当前时点的动态状态。人物可以改变，关系可以变化，但不能因此反向改写原作已经明确的事实。新创作产生的事实也不能伪装成原作事实。

状态记录还应区分事实、推断和未确认信息。例如“某人物在第 12 章亲口说出某事”是有文本证据的事实；“某人物可能已经怀疑另一人”是推断；“某人物是否知道这件事”如果原文没有交代，就应该保持 unknown，而不是让模型补成确定事实。每条重要记录最好保留来源章节、原文片段或可回查的位置。

一个简化的状态结构可以是：

```json
{
  "character": "人物甲",
  "as_of": "第 81 章场景 2 结束",
  "location": "地点 A",
  "knowledge": [
    {
      "fact": "已经获知事件 X",
      "evidence": ["第 81 章场景 2"],
      "confidence": "explicit"
    }
  ],
  "relationships": {
    "人物乙": "关系描述及其变化依据"
  },
  "goals": ["当前目标"],
  "possessions": ["当前持有的重要物品"],
  "open_questions": ["尚未确认的信息"]
}
```

这只是说明数据边界的示例，不是某部具体小说的人物事实。实际项目还应保存状态版本、更新时间和变更来源，便于回滚与追查。

### 从整章生成改为场景级生成

章节仍然是作者规划、阅读和交付的单位，但场景更适合作为生成和状态更新的单位。一次生成整章，容易在长输出中忘记前面刚建立的细节；按场景生成，则可以在每次状态变化后及时检查。

一个可执行的循环如下：

1. **Chapter Planning：** 明确本章在全书中的作用、前置条件、核心冲突、人物出场、必须推进的情节和结尾状态。
2. **Scene Planning：** 把章节拆成若干场景。每个场景定义视角人物、地点、时间、目标、冲突、必须发生和禁止发生的事项，以及预期状态变化。
3. **Context Assembly：** 检索当前场景涉及的人物档案、相关原文、历史事件、未解决情节、前一场景和适用的风格样本。只装配必要上下文。
4. **Scene Drafting：** 生成场景正文。场景目标约束情节，但不把每句台词和每个动作都预先写死。
5. **Continuity Review：** 对照 Canon、人物知识、时间线、地点、物品归属、人物动机和因果关系检查新场景。
6. **State Update：** 从通过检查的场景中提取新增事件和人物状态变化，更新 Event Ledger、Narrative State 和 Plot Requirements。
7. **Next Scene：** 使用更新后的状态生成下一场景。完成所有场景后，再进行整章层面的节奏、结构和文学编辑。

可以把它理解为一个循环，而不是八个必须独立部署的 Agent。一个主 Agent 编排流程，按需调用规划、生成、状态提取和审核能力即可。只有当任务复杂度、模型隔离或并行执行确实需要时，才拆分专门 Agent。

```text
Chapter Plan
    |
    v
Scene Plan
    |
    v
Assemble Context
    |
    v
Draft Scene
    |
    v
Continuity Review
    |
    +---- Failed ----> Local Repair ----+
    |                                   |
    v                                   |
Extract Events & State Changes          |
    |                                   |
    v                                   |
Update Narrative State <----------------+
    |
    v
Next Scene / Chapter Review
```

状态更新不能直接相信生成模型的自我总结。更稳妥的做法是让状态提取器给出“旧状态—新主张—原文证据—置信等级”，由一致性检查确认后再写入正式状态。无法从正文确认的变化留在 Draft State 或标为 unknown。修复场景时也要重新执行状态提取，避免正文已经改了、状态记录却仍保留旧版本。

### Continuity Review 应该检查什么

建议把审核拆成可定位、可举证的检查项，而不是输出一个笼统的“连贯性良好”。

| 检查 | 典型问题 |
| --- | --- |
| Canon Review | 是否与选定版本的原作事实冲突；是否把推测写成原作事实 |
| Character Review | 人物行为是否符合已建立的性格、动机和关系；是否无缘由地改变人物 |
| Knowledge Review | 人物是否提前知道尚未获知的信息；信息通过什么事件传递 |
| Timeline Review | 日期、年龄、事件先后、人物在场时间是否冲突 |
| World Review | 地点、制度、规则和物品属性是否前后变化 |
| Causality Review | 事件是否有合理原因；人物行动是否有足够动机 |
| Plot Review | 已埋伏笔、承诺和未解问题是否被遗忘或无故解决 |
| Voice Review | 叙述视角、人物语言和叙事节奏是否稳定 |

每条问题都应给出：问题类型、严重程度、冲突双方的文本证据、影响范围和建议修复位置。模型的审核结果仍然可能误报或漏报，因此它是编辑辅助，不是文学裁判。对事实和时间线等可以明确核对的约束，尽量使用结构化检查；对人物动机、节奏和文学效果等判断，保留编辑判断。

还要建立回归检查：新章节通过后，不能只检查它自己，也要检查它对后续已规划情节和既有状态的影响。若修改了某个关键事件，受影响的人物知识、关系、物品归属和伏笔状态都要重新计算。

### 案例：从第八十回之后续写《红楼梦》

《红楼梦》适合作为长篇续写的压力测试：人物众多，关系复杂，诗词、判词和伏笔交织，而且存在不同版本与后四十回作者归属的长期争论。开始生成之前，必须先确定采用哪个版本作为依据。不能让模型在脂本系统、程高本和自行推断的情节之间随意切换。

可以设计三种明确的创作分支：

- **从前八十回续写：** 选定具体脂本或校注本作为主要 Canon；后四十回只作为可选参考，明确标记哪些内容是参考材料、哪些不作为约束。
- **从一百二十回之后续写：** 选定具体程高本版本作为 Canon，接受该版本已经给出的结局和人物命运，再规划后续故事。
- **另写一个结局：** 以明确选定的原文版本为基础，建立 Alternate Ending 分支；新结局与既有版本的差异要被记录，不能混成原作事实。

这三个分支不能共用一份未标版本的状态库。每条 Canon 记录都应包含版本标识、章节位置和必要的校勘说明。若不同版本对某个情节存在差异，记录为版本差异，不要由模型自行裁决。

以“从前八十回之后新增若干回”为例，准备阶段应先处理全书，而不是只把第八十回交给模型：

- **人物档案：** 身份、亲属关系、性格、语言特征、重要经历、已知信息、目标和人物命运的版本依据。
- **关系资料：** 亲属、主仆、婚姻、情感、利益和冲突关系，并记录关系随章节发生的变化。
- **时间线：** 重要事件、季节和时间线索、人物年龄的依据，以及无法确定的时间点。
- **地点和物品：** 大观园、荣国府、宁国府等空间关系，以及关键物品的出现、持有和转移记录。
- **事件账本：** 按章节记录重要事件、参与人物、前因后果和原文证据。
- **伏笔与未解情节：** 判词、曲文、人物承诺、尚未兑现的暗示，以及它们在不同版本中的解释差异。
- **文风资料：** 叙述者语言、章回结构、诗词与判词、不同人物的对话样本分别整理，不能把所有人物都写成同一种声音。

完成资料提取后，先规划一个完整的新故事阶段。例如计划新增五回，应先确定五回之间的整体情节关系、人物变化和结尾方向，再为每一回拆分场景。不要让模型先写第八十一回，写到第八十五回才临时决定前面埋下的线索如何收束。

每个场景都需要明确：它承接哪些原文事实、人物当前知道什么、场景结束后哪些状态会变化、推进了哪些情节线索，以及哪些信息仍然不能确定。生成之后，检查人物行为和知识边界，再更新状态。章节完成后，最后进行章回体结构、叙述节奏、人物声音、诗词质量和语言克制等文学编辑。

这里还有一个容易忽略的区别：模仿古典章回体的表面语言，不等于复现《红楼梦》的文学质量。不能靠堆砌文言词、套用诗词格式或频繁使用“且听下回分解”来制造相似感。更值得研究的是叙述视角、人物差异、对话中的潜台词、叙事节奏、讽刺和留白。Style Profile 应从选定版本中提取可观察的写作特征，生成结果仍需文学编辑判断。

### 如何把它纳入通用 AI 写作流水线

不必把普通文章写作也改造成复杂的小说工程。更合适的是保留共享的写作基础设施，再为长篇创作增加专属能力：

| 共享能力 | 长篇小说专属能力 |
| --- | --- |
| Style Sheet / Voice Profile | Character Voice、Narrative Style Profile |
| 资料检索与上下文组装 | Story Bible、Codex、Canon Retrieval |
| 大纲和内容规划 | Story Arc、Chapter Plan、Scene Plan |
| 初稿生成 | Scene-level Generation |
| 内容审核 | Continuity Review、Canon Check |
| 语言编辑 | Literary Editing |
| 文档版本管理 | Narrative State、Event Ledger、Plot Requirements |

可以据此定义 Writing Mode：Article、Fiction、Continuation 等。Continuation 模式启用 Canon、人物状态、事件账本和伏笔管理；普通文章仍使用轻量的资料、Style Sheet、大纲、起草和编辑流程。翻译也继续使用自己的术语、原文依据和译文审核流程，不需要与小说状态管理混在一起。

落地时先做最小闭环：选定一个版本和一段已有文本，提取人物、事件和未解情节；规划一章并拆成场景；每生成一个场景就检查并更新状态；最后对整章做文学编辑。用人物知识错误、时间线错误、事实矛盾、状态更新准确率、人工修订量和章节质量来评估。不要一开始就追求全自动写完整本小说，先验证状态提取和连续性检查是否真的减少了后文矛盾。

**核心结论：Style Sheet 解决“怎么写”，Story Bible 解决“依据什么写”，Narrative State 解决“故事到现在发生了什么，以及接下来哪些变化成立”。** 长篇续写需要三者配合；只增加上下文长度或章节摘要，并不能代替叙事状态管理。

### 长篇小说创作的研究与产品资料

- [Lost in Stories: Consistency Bugs in Long Story Generation by LLMs](https://aclanthology.org/2026.findings-acl.410/) — Junjie Li et al., Findings of ACL 2026。ConStory-Bench 与 ConStory-Checker，长篇故事一致性错误分类和证据化评估。
- [ConStory-Bench GitHub](https://github.com/Picrew/ConStory-Bench) — 论文配套代码与评估实现。
- [ConWriter: Transition-Constrained Stateful Long-Form Story Generation with Lightweight Neuro-Symbolic Consistency Control](https://aclanthology.org/2026.findings-emnlp.359/) — Jindong Li et al., Findings of EMNLP 2026。场景级状态转移约束和一致性控制。
- [ConWriter GitHub](https://github.com/jindongli-Ai/ConWriter) — 论文配套实现。
- [Scaling Long-Form Story Generation via Narrative State Tracking](https://arxiv.org/abs/2609.35759) — Zhennan Wan、Jianfei Chen，arXiv 预印本，提出 NstAgent；页面标注 Under review。
- [Sudowrite Story Bible](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/what-is-story-bible/jmWepHcQdJetNrE991fjJC) — 商业产品的故事资料组织方式。
- [Sudowrite Chapter Continuity](https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/chapter-continuity/4KL8gFeLZQ6GSBjDWtSbV6) — 章节前后文关联。
- [Novelcrafter Codex](https://www.novelcrafter.com/features/codex) — 人物、地点、设定和情节资料库。
- [Awesome LLM Story Generation](https://github.com/Picrew/awesome-llm-story-generation) — 长篇故事生成、连贯性和可控生成相关论文与项目索引。

---

## 一套可以直接落地的 Style Sheet 结构

Style Sheet 不需要一开始就写成几十页。先从一页可维护的规范开始，等真实编辑中出现稳定问题再扩展。下面的结构可以作为个人作者或团队的起点。

| 部分 | 应该记录什么 | 内容示例 |
| --- | --- | --- |
| 写作身份与受众 | 作者身份、读者、发布场景 | 面向工程师的技术解释，不写成营销文案 |
| 语气与立场 | 正式程度、确定性、观点表达方式 | 直接表达判断；不把推测写成事实 |
| 句子节奏 | 长短句、句式变化、信息密度 | 长句解释复杂关系，短句用于明确结论 |
| 段落组织 | 每段承担的论证功能 | 一个段落围绕一个论点，不逐句换行 |
| 词汇与术语 | 偏好用词、术语译法、需要观察的高频表达 | 术语首次出现时给出必要解释 |
| 修辞与描写 | 比喻、情绪、感官细节、强调方式 | 修辞服务于内容，不为显得生动而添加 |
| 禁止或慎用模式 | 重复句式、空洞连接词、模板化收尾 | 不重复标题，不在每节末尾强行总结 |
| 事实与证据 | 引用、数据、来源、推断边界 | 不生成无来源数字，不补造引用 |
| 正反样本 | 作者认可、拒绝和亲自改写的段落 | 保存原文、编辑版和简短原因 |
| 编辑优先级 | 规则冲突时如何取舍 | 原意与事实准确性高于表面风格一致 |

其中最值得持续维护的是正反样本。可以把作者认可的原文、作者亲自改写的句子、AI 生成后被拒绝的例子放在一起。每个样本记录它对应的写作场景和判断原因。这样，模型不仅知道规则，还能看到规则在真实文本中的表现。

不要把 Style Sheet 写成绝对禁令。例如“禁止使用被动语态”会破坏某些技术说明；“禁止使用比喻”会损失文学表达；“每段不超过三句话”可能把复杂论证切碎。更好的写法是说明何时使用、何时避免，以及发生冲突时哪个要求优先。

## 如何判断 Style Sheet 是否真的有效

Style Sheet 是否有效，不能只看模型回答“我已经遵守规范”，也不能靠 AI 检测器判断。需要用真实写作任务做小规模对照。

可以先选择 5 到 10 篇作者认可的历史文章，覆盖不同体裁和表达目的。把其中一部分作为风格样本，另一部分保留作测试。分别让模型在没有 Style Sheet、只有文字规则、文字规则加正反样本三种条件下完成相同类型的写作任务。对比时不要只看“像不像 AI”，而应检查是否保留了作者的常用表达、句子节奏、论证方式、限定习惯和信息密度。

评估最好由作者或熟悉该领域的编辑完成。可以记录几项简单指标：需要人工重写的段落比例、事实或观点偏移数量、重复表达数量、作者对风格匹配的评分，以及从初稿到可发布稿的编辑时间。若 Style Sheet 让初稿更像作者，却增加了事实错误或编辑时间，也不能算成功。

还要定期更新样本。模型版本、写作主题和读者变化都可能让原来的规范失效。更新时应先确认某个偏好是否稳定存在，再将其写入规则；不要因为一次不满意的输出就增加一条永久禁令。

## 不要把“去 AI 味”变成另一种模板

“去 AI 味”很容易走向另一个极端：把某些词列入黑名单，把句子强行改短，把连接词全部删除，再要求模型制造口语、错别字或不规则表达。这些做法可能让文本表面上不那么像模型，却不一定更准确、更自然，也可能破坏作者原有的表达方式。

更可靠的编辑目标是去掉没有信息增量的内容，修正不合适的句式和重复结构，保留真正有用的修饰、限定和转折。一个句子是否应该删掉，取决于它是否帮助读者理解；一个词是否应该保留，取决于它在当前语境中的作用。不能因为某个表达经常出现在模型输出里，就认定人类作者不应该使用它。

作者声音也不是一份可以完全外包给模型的配置。Style Sheet 能帮助模型更接近目标，但它不能替作者决定什么值得写、哪些观点可以署名、哪些经历属于作者本人。模型生成的文本越接近可发布状态，作者越需要知道其中哪些内容来自自己的原始材料，哪些是模型新增的组织和表达，哪些是模型补充的实质观点。

Tim Kao 提出的“最低必要干预”可以作为一个很好的默认原则：如果只需要清理转录，就不要让模型重写全文；如果只需要调整段落，就不要让它改变论点；如果模型提出了新观点，就先拿出来讨论。让 AI 做它擅长的整理、比较、起草和反馈，让作者保留对内容、判断和最终表达的控制权。

## 参考资料

1. [AMA - Coral Hart](https://www.reddit.com/r/WritingWithAI/comments/1rx9eun/ama_coral_hart/) — Reddit，2026-03。作者关于 Style Sheet、Craft Bible、Codex、编辑和 AI-isms 的经验分享。
2. [Do LLMs write like humans? Variation in grammatical and rhetorical styles](https://doi.org/10.1073/pnas.2422455122) — Alex Reinhart et al., PNAS, 2025。
3. [Catch Me If You Can? Not Yet: LLMs Still Struggle to Imitate the Implicit Writing Styles of Everyday Authors](https://aclanthology.org/2025.findings-emnlp.532/) — Zhengxiang Wang et al., Findings of EMNLP, 2025。
4. [Can You Make It Sound Like You? Post-Editing LLM-Generated Text for Personal Style](https://aclanthology.org/2026.acl-long.2030/) — Connor Baumler et al., ACL, 2026。
5. [Fine-Tuning Generative AI for Content Creation](https://www.cmu.edu/computing/news/2024/ai-correspondent/ai-daily-correspondent.html) — Carnegie Mellon University Computing Services, 2024。
6. [Stop Writing Rules for Your AI](https://sacredvision.substack.com/p/stop-writing-rules-for-your-ai) — Sunny Sink, 2026-09-04。以样本标注和人工改写建立个人 Voice 文件的实践经验。
7. [How I Intend to Use AI in My Writing](https://timkao.substack.com/p/how-i-intend-to-use-ai-in-my-writing) — Tim Kao, 2026-10-02。关于最低必要 AI 干预、作者声音和内容贡献边界的个人框架。
8. [Co-Writing with AI, on Human Terms: Aligning Research with User Demands Across the Writing Process](https://arxiv.org/abs/2504.12488) — Mohi Reza et al., 2025。回顾 109 篇 HCI 论文并访谈 15 位写作者。
9. [Generative AI’s Impact on Graduate Student Professional Writing Productivity and Quality](https://link.springer.com/article/10.1007/s40593-025-00528-z) — Allison E. Connell Pensky et al., International Journal of Artificial Intelligence in Education, 2025。
10. [Style, sentiment, and quality of undergraduate writing in the AI era](https://doi.org/10.1016/j.caeai.2025.100507) — Matthew H. C. Mak and Lukasz Walasek, Computers and Education: Artificial Intelligence, 2025。

11. [Vale](https://github.com/vale-cli/vale) — 开源 prose linter；官方 README 说明其可将团队写作规范转为编辑器和 CI 检查。
12. [human-writing](https://github.com/KKKKhazix/human-writing) — 中文 AI 写作与改稿 Agent Skill。
13. [Write Like Me](https://github.com/HopLittleBunny/write-like-me) — 从个人样本学习写作模式，并提供语义保护和修改反馈学习。
14. [write-like-me-mcp](https://github.com/gwicho38/write-like-me-mcp) — 本地 MCP 写作风格分析与样本检索工具。
15. [House Style System](https://github.com/kalensr/house-style-system) — House Style、Vale 门禁和可选声音评审/eval 工作流。
16. [The Style Guide](https://github.com/cote/the-style-guide) — 可移植、多命名风格的 Claude Skill。
17. [nabokov](https://github.com/viewflow/nabokov) — 英文 prose linter，包含可选 AI 写作痕迹检查。
18. [WRITER Brand](https://writer.com/brand/) — 官方产品说明：品牌 Voice、批准用语和写作规则。
19. [Grammarly Style Guide](https://www.grammarly.com/business/styleguide) — 官方产品说明：组织 Style Guide、规则和 Brand Tones。
20. [Jasper IQ](https://help.jasper.ai/hc/en-us/articles/55085068545819-Jasper-IQ) — 官方文档：Brand Voice、Audience、Knowledge Base、Style Guide 等品牌上下文组件。

---

*本文区分了作者经验分享、组织实践和受控研究。AMA 与个人文章用于理解真实工作方法，不代表独立质量评估；实验结果只适用于论文所描述的模型、样本和任务，不能直接外推到所有语言、体裁和写作场景。*
