# 文学历史数据集综述：面向人工智能、机器学习与数字人文的语料地图

**发布时间：2026 年 10 月 24 日**  
**研究基准日：2026 年 10 月 24 日**  
**适用读者：** 文学研究者、历史学者、数字人文团队、NLP/ML 工程师、档案馆与图书馆数字化团队，以及构建阅读、检索、研究和翻译系统的开发者。

## 摘要

文学与历史数据是人工智能的重要材料，但其数据生态和新闻、网页或通用 NLP 语料有明显区别：一部小说可能同时有原版、修订版、译本、删节本和不同数字化副本；一份历史档案可能只有扫描图像，文字还需要 OCR 或手写文本识别；同一个人物可能有姓名、别名、头衔、敬称和时代变体；一份作品的版权状态也可能因司法辖区、译文、校注和数字化版本而不同。因此，不能简单把“网上能读到”当作“可以批量下载”，把“可以下载”当作“可以用来训练商业模型”，或把经过 OCR 的文本当作原始文献的可靠转录。

本文按文学小说、诗歌戏剧、书信日记、历史档案、报刊、手稿、传记与人物关系、古典语言及中日文历史文本等方向，整理可以用于 AI/ML 的代表性数据集和数字图书馆，区分开放许可、免费访问、学术授权、商业订阅和价格未公开的数据；将重要论文与项目对应到具体语料；列出非 LLM 与 LLM 项目；并给出从采集、版权审查、OCR/HTR、清洗、标注、版本管理到模型评估和生产运行的工程建议。

最重要的结论是：**先确定研究问题、文本版本和使用权，再选择模型。** 研究人物关系应优先选择带人物/共指标注的文学语料；研究语言演变应使用具有可靠时间元数据的历时语料；研究历史事件应结合原始来源、档案描述和实体关系；训练语言模型则应选择许可证明确、来源可追溯、允许相应用途的文本，而不是依赖版权状态不明的书籍集合。

## 1. 如何理解“开源文学与历史数据集”

“开放”至少包含五个不同维度：

| 维度 | 典型状态 | 使用前需要确认 |
|---|---|---|
| 在线阅读 | 网页可以打开或搜索 | 是否提供批量下载、API 或机器访问 |
| 数据可访问 | 提供文本、图像、OCR、导出或 API | 访问是否限额、需要机构账号，是否允许自动化抓取 |
| 许可开放 | 有明确开放许可或公有领域依据 | 是否要求署名、相同方式共享、非商业使用或禁止衍生 |
| 允许机器学习 | 许可与源材料权利允许预定的训练或推理用途 | 是否允许训练、微调、embedding、检索缓存和模型权重发布 |
| 允许商业使用/再分发 | 可用于商业系统、对外提供或再分发 | 是否包括全文、派生标注、模型输出、客户查询和跨组织使用 |

本文使用如下分类：

- **开放/可下载：** 有明确数据或 API 入口，但仍需遵守具体许可。
- **免费访问但受限：** 可以免费查询或研究，但批量全文、研究环境、商业用途或再分发有约束。
- **学术机构授权：** 可能通过大学图书馆、研究中心或数据协议访问。
- **商业订阅/询价：** 通常需要图书馆、档案机构或企业合同；若供应方没有公开统一价格，就标为“价格未公开/需询价”。
- **许可不明确或有争议：** 不应默认用于模型训练或再分发。此类资源可作为研究背景或待核实清单，不宜直接进入训练集。

文学作品的公有领域状态与数字化文件、现代校注、翻译、封面图像、数据库汇编权利是不同问题。尤其要区分“原作进入公有领域”和“所下载的特定电子版本可按任意许可证使用”。跨国使用时，作品保护期、作者去世年份、首次出版时间和本地版权规则都可能影响结论。

## 2. 文学、小说与戏剧：主要数据集和获取方式

### 2.1 通用文学作品与长篇小说

| 数据集/来源 | 内容与适用任务 | 获取与许可概况 | 重要限制 |
|---|---|---|---|
| [Project Gutenberg](https://www.gutenberg.org/) | 大量公有领域电子书、小说、诗歌、戏剧、散文、传记和历史文本；适合文学检索、文体分析、作者归属、实体提取和部分语言模型实验 | 书目元数据、MARC、RDF 及电子书可免费访问；有自己的许可证与商标规则 | 每本书都要检查书内许可和所在司法辖区；少数作品是经权利人许可收录，不代表授权自动扩展给下载者；不要把 Gutenberg 商标当作数据集许可证 |
| [PG-19](https://github.com/google-deepmind/pg19) | 从 Gutenberg 选出的约 28,000 本 1919 年前出版的书，作为长上下文语言建模基准 | 数据集和元数据由 Google DeepMind 研究项目发布，常用于长文档语言建模 | 来源书籍的权利和分发条款仍须核查；它是 benchmark，不等于所有书都可不受限制地用于商业训练 |
| [LitBank](https://github.com/dbamman/litbank) | 100 部英语小说/文学作品的人工标注样本，总计 210,532 tokens；含实体、事件、人物共指和引语说话人归属 | 学术研究常用的公开标注集；GitHub 当前许可文件/README 与最初论文中的许可表述应按使用版本核验 | 规模适合监督学习和评测，不足以代表所有时代、文类、语言或全球文学 |
| [HTRC BookNLP / ELF](https://htrc.atlassian.net/wiki/spaces/COM/pages/43300179/HTRC%2BBookNLP%2BDataset%2Bfor%2BEnglish-Language%2BFiction) | 由约 213,000 卷英语小说运行 BookNLP 获得的角色、实体、词语等衍生数据，支持大规模文学分析 | HathiTrust Research Center 提供满足非消费式研究政策的衍生数据；不是可以下载所有受版权保护小说全文的通道 | 衍生结果受到数据政策约束；不能从该项目推断原书全文已开放，也要核验当前项目服务和条款 |
| [HathiTrust Research Center Extracted Features](https://analytics.dev.htrc.indiana.edu/deriveddatasets) | 大规模图书的书目元数据、分页统计、词频和词性特征；v2.0 页面描述覆盖约 1,712 万卷 | 可下载的非消费式衍生特征覆盖公有领域与版权内书籍 | 特征不是原文全文；页面级词袋与词频适合宏观分析，但无法替代逐段阅读、RAG 或全书微调 |
| [Google Books Ngram](https://books.google.com/ngrams/info) | 按年代聚合的 n-gram 频率，适合研究词汇兴衰、概念流行、文化趋势和部分历时语言现象 | Google 提供可下载的 n-gram 数据；官方说明图表和数据可用于各种用途，并建议注明来源 | 这是聚合统计，而不是完整图书文本；受语种、版本、OCR、书籍出版分布和语料构成偏差影响 |
| [Internet Archive](https://archive.org/) / Open Library | 大量扫描图书、借阅式数字书籍、OCR 文本和元数据 | 不同条目有不同访问模式和权利状态；不是统一的开放数据集 | 要逐条核对权利、借阅/访问条款和 API 限制；“有 OCR 文件”不意味着全文可用于模型训练 |
| [Common Pile v0.1（NeurIPS 2025）](https://proceedings.neurips.cc/paper_files/paper/2025/hash/52acc050138d6f40dad6f12f91a4ce22-Abstract-Datasets_and_Benchmarks_Track.html) | 面向预训练的约 8 TB 公有领域与开放许可文本，覆盖书籍、论文、百科、教育资料等 | NeurIPS 2025 数据集论文公开介绍，并发布数据、处理代码与模型 | 训练语料混合包的各来源许可、版本和保留规则仍应在实际下载清单中核对；不能因为它是开放许可项目，就忽略每个来源的限制 |
| [The Pile](https://arxiv.org/abs/2101.00027) / Books3 / BookCorpus / BookCorpus2 | 曾用于大型模型或研究的书籍语料组合，可理解为 LLM 训练数据史的重要案例 | 公开论文可研究其组成；数据可用性和版权状态不统一，部分子集存在明显权利争议 | **不应把它们作为默认的“合法开放小说集”**；开源模型权重也不代表训练书籍均有可再利用许可 |

> 关于 Common Pile：NeurIPS 2025 的正式论文题为 *The Common Pile v0.1: An 8TB Dataset of Public Domain and Openly Licensed Text*。为避免把不稳定的预印本编号写入正文，直接以[会议论文页面](https://proceedings.neurips.cc/paper_files/paper/2025/hash/52acc050138d6f40dad6f12f91a4ce22-Abstract-Datasets_and_Benchmarks_Track.html)为主入口。

#### Project Gutenberg 的正确用法

Gutenberg 适合启动文学 NLP，因为文本获取门槛低、书目元数据相对标准、长文本足够完整。但应保留 Gutenberg ebook ID、原始 URL、下载日期、书内版权声明、书目记录、语言、作者与出版信息。不要只存文件名或标题，因为同名作品、不同译本、修订版和重复数字化文本可能同时存在。

官方授权说明强调每个电子书可能适用不同状态，且美国之外使用者要单独考虑当地法律。参考：[Gutenberg 许可证解释](https://www.gutenberg.org/policy/license)、[Permissions、版权与商标](https://www.gutenberg.org/policy/permission.html)、[电子书目录](https://www.gutenberg.org/ebooks/)。其书目资源还提供 MARC、MARCXML、RDF 和可下载目录；可以先根据元数据筛选，再按需取正文，避免无目标地批量下载所有文本。

### 2.2 文学语言任务的标注数据集

| 数据集 | 任务与标签 | 对应论文/项目 | 适合用来做什么 |
|---|---|---|---|
| LitBank | 人物、地点、组织等实体；嵌套实体；真实发生事件；篇章级人物共指；引语归属 | Bamman、Popat、Shen 的 *An Annotated Dataset of Literary Entities*（NAACL 2019）；Sims、Park、Bamman 的 *Literary Event Detection*（ACL 2019）；Bamman、Lewke、Mansoor 的 *An Annotated Dataset of Coreference in English Literature*（LREC 2020） | 文学实体识别、角色别名归一化、长距离共指、角色关系图和引用对白分析 |
| [BookNLP](https://github.com/booknlp/booknlp) | 针对书籍的 NLP pipeline：词性、依存关系、实体识别、角色名聚类、共指、引语说话人识别、语义类型、事件等 | Bamman 等的文学 NLP 工作与后续 BookNLP 代码/模型 | 处理小说中常见的称呼变化，比如“Elizabeth”“Lizzy”“Miss Bennet”；构建角色出现轨迹、角色网络、对白比例和事件图 |
| [NovelTM / HTRC ELF](https://htrc.atlassian.net/wiki/spaces/COM/pages/43300179/HTRC%2BBookNLP%2BDataset%2Bfor%2BEnglish-Language%2BFiction) | 大规模小说自动抽取后形成的实体、角色和词语衍生表 | HTRC 的数字人文和文化分析项目 | 做大规模跨时代角色、性别表征、角色网络或词汇使用研究；要意识到自动标注噪声和样本分布偏差 |

LitBank 的论文发现，在文学文本上使用领域内标注数据训练实体识别，较直接迁移新闻领域模型可以显著改善表现。其核心启示不仅是“要有更多数据”，而是**标注体系必须匹配文本类型**：文学人物可能以普通名词短语出现，也可能采用嵌套描述；引语不总是有标准引号；叙述者、人物意识、回忆、假设和梦境会让事件标注更复杂。

### 2.3 诗歌、戏剧、书信与其他文类

诗歌、戏剧和私人书信往往需要比一般小说更细的结构。诗行、诗节、韵律、角色台词、舞台提示、信件日期、发件人与收件人等，不能在普通的“按段落切 chunk”时被丢弃。

| 数据源 | 主要内容 | 访问/价格状态 | 典型用途 |
|---|---|---|---|
| [Folger Shakespeare Library](https://www.folger.edu/explore/shakespeares-works/) | 莎士比亚文本、版本、注释和研究资源 | 具体文本与图像的下载/再利用条件依资源而定；需检查 Folger 的权利说明 | 戏剧角色对话、文本版本比较、引语归属、舞台指示和作者归属研究 |
| [Shakespeare and the Canon](https://www.opensourceshakespeare.org/) / 开放莎士比亚文本项目 | Shakespeare 作品的结构化文本和词汇检索 | 以具体项目的版权与再分发条件为准 | 角色对白、词频、舞台场景、作者归属基线 |
| [Poetry Foundation](https://www.poetryfoundation.org/) 等诗歌网站 | 诗作元数据、作者、主题与部分全文 | 网站可读不代表全文批量训练权已开放 | 诗歌语义、检索、推荐和主题研究；商业训练前必须获得授权 |
| [Women Writers Project](https://wwp.northeastern.edu/) | 早期现代女性写作的数字化、TEI 编码文本与研究资源 | 不同项目与文本的访问和复用许可需按其数据政策确认 | 历史女性写作、数字版本学、元数据与体裁研究 |
| [Corpus of Early English Correspondence (CEEC)](https://varieng.helsinki.fi/CoRD/corpora/corpusfinder/) | 1402–1800 年书信语料；不同版本约数百万词、数千封信 | 不同子集存在机构订阅、现场访问、免费订阅或开放 sampler 等条件 | 社会语言学、历时语义、称谓与礼貌演变、书信社交网络 |
| [Corpus of Historical American English (COHA)](https://www.english-corpora.org/coha/) | 1820–2019 年的历时美式英语，按年代与文类平衡，超过 4.75 亿词 | 在线访问与可下载数据权限不同；机构通常通过订阅或学术许可使用；统一商业价格未确认 | 研究英语词汇与语义变化、体裁差异和文化趋势 |
| [Corpus Resource Database (CoRD)](https://varieng.helsinki.fi/CoRD/) | 历时与专门语料的目录，覆盖多种语言、年代、文类和许可类型 | 各语料单独申请或取得许可 | 发现适用于书信、口语、早期现代英语、社会语言学或历史语料的具体资源 |

研究早期现代文学时，尤其要区分原始文本、校勘文本、编辑者说明、脚注、现代化拼写版本和翻译。自动化流程若把所有文本层混在一起，文体分析和作者归属的结果可能会主要反映现代编辑者而非原作者的语言。

## 3. 历史档案、报纸、手稿与数字化数据

### 3.1 大型历史文本与报纸

| 数据集/来源 | 内容、规模或时间跨度 | 获取与许可 | 适用任务 |
|---|---|---|---|
| [Chronicling America](https://www.loc.gov/collections/chronicling-america/) | 美国历史报纸，页面覆盖至 1963 年；提供扫描图像、OCR/ALTO 和目录元数据 | Library of Congress 提供公开 API 和批量 OCR；许多内容为公有领域或无已知版权限制，但近期页面可能含第三方受版权保护材料 | 历史事件抽取、地方新闻与社会变迁、地名演变、OCR 模型评估和报刊实体网络 |
| [Library of Congress Datasets](https://www.loc.gov/collections/chronicling-america/datasets/) | 按数据批次提供 OCR、文件结构、校验和以及数据下载 | 公开访问；需保留批次、checksum、原始标识和版权信息 | 构建可重复的报纸 NLP、图像分类和新闻页面研究 |
| [Europeana Newspapers](https://www.europeana.eu/) | 欧洲多国历史报纸与数字化报刊内容；社区转换的数据集声称汇集 12 种语言、约 320 亿 tokens | 原始门户、内容提供机构、单项数字对象和社区衍生集的许可不一定相同 | 多语言历史新闻、跨国事件与语义变化、OCR 质量研究；不能把非官方汇编的规模当作统一开放许可证 |
| [Living with Machines](https://www.turing.ac.uk/research/research-projects/living-machines) | 英国 19 世纪的报刊、地图、人口普查、书籍和期刊，强调跨数据源链接 | 项目发布了一批可复用数据与工具；需按各个产物的具体许可证使用 | 历史地名链接、报刊与人口/地图数据联合分析、工业化社会研究 |
| [LwMDB: Living with Machines Database](https://research.lancaster-university.uk/en/datasets/lwmdb-data/) | 英国图书馆历史报刊的元数据与关联数据 | 研究数据集可通过研究机构存储库访问；引用其 DOI 与数据版本 | 报纸标题、日期、地点及多源馆藏之间的实体解析与空间研究 |
| [Old Bailey Proceedings Online](https://www.oldbaileyonline.org/) | 伦敦中央刑事法庭 1674–1913 年审判记录，是大规模历史司法叙事的经典数字语料 | 可在线搜索并提供数据资源；下载格式、再利用范围和具体版本需看项目政策 | 历史犯罪、司法制度、社会史、人物/地点识别、事件时间线与叙事变化 |
| [British Library / British Newspaper Archive](https://www.britishnewspaperarchive.co.uk/) | 大规模英国历史报纸数字化全文与页面图像 | 多数全文和下载能力采用订阅/按访问授权；没有可通用适用的统一价格可直接引用 | 新闻事件抽取、历史词汇变化、地方史与报纸版面 OCR |
| [Trove](https://trove.nla.gov.au/) | 澳大利亚图书馆、报纸、期刊与数字收藏 | 提供搜索和 API；具体数据、抓取方式和再利用权依条目和来源而异 | 澳大利亚社会史、人物与地名抽取、历史报纸研究 |
| [Gallica / Bibliothèque nationale de France](https://gallica.bnf.fr/) | 法国国家图书馆数字化书籍、报刊、地图、手稿等 | 页面阅读和 API 可用；全文/图像批量获取和商业用途必须核验 Gallica 与来源馆的条款 | 法语文学、法国史、跨版本文本与 OCR/HTR |
| [Internet Archive](https://archive.org/) | 历史出版物、扫描书籍、期刊和多媒体材料 | 有开放文件，也有受控数字借阅与权利限制；按条目检查 | 长尾文献研究、数字保存、文档图像处理 |
| [Europeana](https://www.europeana.eu/) | 欧洲文化遗产元数据、图像和文本链接 | 元数据开放条件与每个内容提供方的对象版权不同；通常应利用 Europeana rights statement | 统一目录、跨馆检索和多语种研究数据发现 |

Chronicling America 的重要工程价值不仅是内容免费，而是它保留了可关联的页码/URL、ALTO XML、METS XML 和馆藏元数据。美国国会图书馆在 2025 年迁移了旧 API；2026 年的迁移说明要求使用新的 loc.gov API，并继续提供批量 OCR 下载。新采集器不应绑定旧版接口。[API 说明](https://www.loc.gov/apis/additional-apis/chronicling-america-api/)、[迁移说明](https://www.loc.gov/ndnp/migration/)、[版权与访问](https://www.loc.gov/collections/chronicling-america/about-this-collection/rights-and-access/)。

### 3.2 历史手稿与 OCR/HTR 训练数据

历史档案通常经历扫描、版面检测、行切分、OCR/HTR、人工校订、文本结构编码和出版。每个阶段都可能改变数据，必须保留各阶段产物和对齐关系。

| 数据集/项目 | 语言与材料 | 常见研究用途 | 获取/许可注意点 |
|---|---|---|---|
| [READ 2016](https://readcoop.eu/) | 历史手写文档识别挑战数据，常见基准覆盖德语 Kurrent 手写文书 | 行/词识别、文档布局和 HTR 基准 | 数据权限因挑战集或镜像而异，必须核验原始分发条款 |
| [Bentham Dataset](https://zenodo.org/search?q=Bentham%20Handwritten%20Text%20Recognition) | Jeremy Bentham 手稿与人工转录，常用于历史手写英文识别 | HTR、跨时期写字习惯适配、文档版面分析 | 需按具体 Zenodo 发布版本检查数据 DOI、图像权利和转录许可 |
| [IAM Handwriting Database](https://fki.tic.heia-fr.ch/databases/iam-handwriting-database) | 现代英语手写文本，非专门历史档案 | 通用手写识别基线，评估识别模型在干净手写数据上的表现 | 访问常需要注册并遵守研究用途条款；它不能替代古手稿真实测试 |
| [Saint Gall](https://github.com/PRHLT/Read) | 中世纪拉丁手写材料 | 拉丁手写识别与古文字的版面/行识别 | 需核验具体项目数据说明、原始影像和转录权利 |
| [Esposalles](https://zenodo.org/search?q=Esposalles%20HTR) | 历史西班牙语婚姻记录 | HTR、人口史、表格/登记字段抽取 | 图像、转录与标签的许可可能不同 |
| [IMPACT Dataset Archive](https://digitisation.eu/datasets/) | 历史书籍、报纸、手稿、OCR、HTR、版面和 ground truth 多种资源 | 模型基准选择和文档识别流水线 | 每个数据集提供自己的语言、许可证、标注类型和下载方式 |
| [Transkribus Public Datasets](https://www.transkribus.org/datasets) | 用户及机构创建的历史文书页面/转录数据集 | 文本识别、版面分析、表格和字段识别 | 每个公共数据集有单独许可、版本与来源；有些允许商业或 AI 训练，有些不允许 |
| [Kuzushiji Dataset / KMNIST](https://codh.rois.ac.jp/kmnist/index.html.en) | 日本古籍草书假名与汉字图像；KMNIST 70,000 张 28×28 图像，Kuzushiji-49 270,912 张，Kuzushiji-Kanji 约 140,000 张图像 | 字符识别、古籍图像分类和日本历史文本 OCR 前处理 | 具体衍生数据集遵循其发布许可证并应引用 DOI；字符图片分类不等同于整页古籍转录 |

#### OCR/HTR 的公开价格实例

[Transkribus 官方价格页](https://www.transkribus.org/pricing)在本研究时展示免费方案每月 50 credits；Scholar 页面列示 €99/年（年付）及额外额度，Team 页面列示团队年付套餐，机构方案需报价。该服务的费用与使用页面数、识别类型和套餐额度相关，且团队页面与帮助文档可能因价格调整存在不同数字。采购前以当日结算页为准，不应把云端识别价格与数据集许可混为一谈。机构规模项目也可以部署 Kraken + eScriptorium 等开源路线，但需自行承担 GPU、存储、标注和运维成本。

### 3.3 历史文本不是“OCR 后的普通文本”

扫描图像中的纸张污渍、旧字形、长 s、连字、分栏、页眉、页脚、行末断词、旁注和边缘裁切会影响文本。历史文书还可能含缩写、异体字、不同拼写标准、跨行补写和编辑者注释。

对于学术研究，应尽可能保留以下多个层次：

- 原始图像或 IIIF canvas，作为可以回到证据的来源。
- 原始 OCR/HTR 结果，包含模型版本、识别时间和置信度。
- 校订转录，保留人工修改与校订者记录。
- 外交式转录（diplomatic transcription），尽量忠实于原稿拼写、标点、划改和段落。
- 规范化版本（normalized text），供需要统一拼写的分析使用。
- 结构化标注，包含人物、地名、日期、页码、段落、标题、脚注和实体关系。

不要覆盖原始 OCR 结果，也不要把现代拼写归一化后的版本当作唯一“事实”。若任务是历史语义变化，旧拼写本身可能是研究信号；若任务是内容检索，可以提供标准化索引，但检索结果应同时返回原文证据与页码。

## 4. 中日韩与古典语言：不能忽略的语料生态

### 4.1 中文古典文献与人物历史数据

| 数据集/项目 | 内容 | 许可/访问概况 | 可用于什么 |
|---|---|---|---|
| [Chinese Text Project（中国哲学书电子化计划）](https://ctext.org/) | 三万多种前现代中文文本、五十多亿汉字，涵盖先秦、两汉、史书、哲学、文学和诗文；提供 API、结构化数据和数字人文工具 | 网站开放访问并提供 API/数据工具；是否允许批量再分发、商业训练和衍生服务仍要查看具体条款及作品来源 | 古汉语 NLP、文本复用、n-gram、文献相似性、引文网络和历史概念研究 |
| [China Biographical Database（CBDB）](https://cbdb.hsites.harvard.edu/) | 主要覆盖 7–19 世纪的中国历史人物传记、社会关系、地理和官职；2026 年官方页面报告约 657,909 人 | 2026-08-20 起许可条款分版本/数据范围：旧单机版内数据适用 CC BY-NC-SA 4.0；超出当前发布范围的数据受更严格的非商业、禁止衍生与再分发规则约束 | 历史人物实体消歧、社会关系图、籍贯分布、人物生平和文献知识图谱 |
| [Academia Sinica / 中央研究院数字资源](https://digitalarchives.tw/) | 历史文献、档案、人物和机构相关数字收藏 | 按数据库和馆藏分别确定授权；部分可搜索，部分数据需要申请 | 历史文书、实体链接、地理信息系统和档案数字化研究 |
| [CHGIS：中国历史地理信息系统](https://sites.fas.harvard.edu/~chgis/) | 历史地名、行政区划、时间与空间关联 | 不同发布版本的获取和使用条件需核验 | 历史地点解析、地名变迁、地图/文本结合和历史路线研究 |
| [Wikidata](https://www.wikidata.org/) 与 [Wikibase](https://wikiba.se/) | 现代与历史人物、作品、地点、别名、关联关系 | Wikidata 结构化数据为 CC0；各实体来源和外链内容仍有不同权利状态 | 用于实体规范化、跨语种标识和构建可追溯知识图谱，而不是替代原始史料 |

CBDB 是一个特别值得注意的例子。虽然它长期被称为“自由访问”的历史人物数据库，但官方已在 2026 年 8 月发布新许可条款，把当前单机版数据库和其后新增/超出该范围的数据分开规定。做持续增量抓取或公开 API 服务时，不能只看某一旧版下载文件的许可证。应记录下载版本、数据量、发布日期和适用条款。[CBDB 数据许可](https://cbdb.hsites.harvard.edu/cbdb-data-licensing-terms)。

Chinese Text Project 的 API 与文本工具能用于文本分析、文本复用和数据整合；但开放访问不自动等于所有文本和数据表都具有同一的开放商用许可。参见[数字人文工具与 API](https://ctext.org/digital-humanities)。

### 4.2 日本前现代文本与古文字

日本国文学研究资料馆与 ROIS-DS Center for Open Data in the Humanities（CODH）发布的 [Dataset of Pre-Modern Japanese Text](https://codh.rois.ac.jp/dataset/index.html.en) 提供部分古籍图像、文本、摘要与标签；其衍生的 Kuzushiji 数据集用于识别旧字形，KMNIST/Kuzushiji-49/Kuzushiji-Kanji 能作为入门图像分类和识字模型的基准。

如果任务是小说翻译、古典文学阅读或历史人物研究，不应只用 KMNIST：它解决的是字符图像分类，而不是复杂版面的行识别、古文断句、训读、古典语法或整书结构。完整流程可能还需要书影、版面分割、文字识别、古典语言模型、注释和现代日语译文对齐。

### 4.3 古希腊、拉丁及阿拉伯/波斯历史文本

| 项目/数据集 | 内容与规模 | 使用限制 | 适用领域 |
|---|---|---|---|
| [Perseus Digital Library](https://www.perseus.tufts.edu/) | 古希腊语、拉丁语及相关古典文本、译文、词典和形态学资源 | 各文本、译文、图像和衍生注释的许可证可能不同 | 古典文学、语文学、形态分析、译文对齐和引用关系 |
| [Open Greek Corpus](https://opengreek.org/) | 2026 年网页报告约 81.9 million tokens、3,910 部作品和 1,501 位作者，整合 First1KGreek、Perseus、教父文献和其他开放版本，并附词元、词性和形态标注 | 逐个来源与注释层的许可和标注来源仍需记录；自动标注与人工 treebank 必须区分 | 古希腊语 NLP、版本比较、形态研究、文本检索与长时段词义变化 |
| [Classical Language Toolkit（CLTK）](https://github.com/cltk/cltk) | 面向前现代欧亚语言的 Python NLP 工具，支持古典语言分析与可选的本地/云端模型后端 | 软件库 MIT 许可，不代表其下载的每一份语料都拥有相同许可证 | 分词、词元、形态和语言特定处理；可与本地 LLM 结合做辅助解释 |
| [OpenITI Corpus](https://openiti.org/projects/OpenITI%20Corpus.html) | 阿拉伯语与波斯语的可机器处理语料，重点覆盖前现代伊斯兰世界文本；公开版本页面报告 10,202 个文本文件、6,236 部不同作品、2,582 位作者 | 当前 OpenITI 版本采用 CC BY-NC-SA 4.0；非商业和相同方式共享条件不适合默认用于商业模型训练或闭源衍生语料 | 阿拉伯/波斯历史文本研究、引文与文本复用、文献谱系、传记史与知识图谱 |

以古典语言为例，模型的首要瓶颈可能并不是参数规模，而是缺少可靠的分词、词元、形态、语料版本和人工校订。CLTK、Open Greek Corpus 和 OpenITI 的价值在于把语言学与版本知识带入语料，而不是简单把古文本塞入通用 tokenizer 后期待模型自动理解。

## 5. 商业/机构授权语料与价格透明度

文学史数据的订阅费经常按机构、数据库、授权范围、并发席位、全文下载、计算环境和 text/data mining 权限定制，而不是按“多少本书”统一售卖。以下把可核实的访问属性和未公开价格分开说明。

| 数据库/供应方 | 覆盖范围 | 当前常见访问方式 | 价格状态与采购重点 |
|---|---|---|---|
| [Early English Books Online（EEBO）/ ProQuest](https://proquest.libguides.com/eebopqp) | 1475–1700 年早期英文书籍，包含超过 146,000 个标题以及相关历史小册子和印刷品 | 通过高校和研究机构的 ProQuest 平台订阅 | 官方页面没有提供可普遍适用的公开价格；需机构报价。必须问明 OCR 全文下载、批量研究、云环境和 AI 训练是否获授权 |
| [Eighteenth Century Collections Online（ECCO）/ Gale](https://www.gale.com/primary-sources/eighteenth-century-collections-online) | 18 世纪出版物的数字化馆藏，支持历史研究和数字人文 | 机构订阅、Gale Digital Scholar Lab 或专门研究授权 | 价格通常按合同、机构和模块报价；必须区分检索权限、全文访问、批量语料与计算分析权限 |
| [Gale Digital Scholar Lab](https://www.gale.com/primary-sources/digital-scholar-lab) | 在 Gale 授权内容上进行文本与数据分析的研究平台 | 机构许可，通常不按普通个人免费下载理解 | 询价；重点核验工作集大小、可导出的衍生结果、数据环境和可否带入自建模型 |
| [HathiTrust Digital Library](https://www.hathitrust.org/) / HTRC | 大规模高校图书馆数字化书籍，含公有领域及版权内资源 | 访问取决于版权、会员机构、研究资格和特定非消费式工具 | HTRC 特征数据可用于某些研究；版权内全文通常不能随意下载。机构支持、服务状态与协议需在项目启动时重新确认 |
| [Corpus of Historical American English（COHA）](https://www.english-corpora.org/coha/) | 1820–2019 年约 4.75 亿词的平衡历时美式英语文本 | 在线接口、学校许可、特定学术下载许可 | 无法确认统一公开商业价格；机构需核对下载权限和再利用条款 |
| [Corpus of Early English Correspondence（CEEC）](https://varieng.helsinki.fi/CoRD/corpora/corpusfinder/) | 1402–1800 年早期英语书信 | 不同采样版、标注版和完整语料的获取方式不同，部分通过现场访问或免费订阅 | 部分版本公开，完整版本可能受学术许可约束；不应将 sampler 误当全量版本 |
| [Oxford Scholarly Editions Online](https://www.oxfordscholarlyeditions.com/) | 经校订的文学/古典文本及学术注释 | 常通过机构订阅与出版社授权 | 价格未确认；文本校勘、注释与引文数据库需要单独确认是否可导出和用于 NLP |
| [JSTOR](https://www.jstor.org/) / JSTOR Data for Research 历史项目 | 文学批评、历史期刊、书籍与学术文献 | 取决于机构许可、开放访问和具体数据服务 | 不能把阅读全文权限视为期刊批量下载、训练或对外提供向量索引的权利 |
| [Literature Online（LION）](https://about.proquest.com/en/products-services/lion/) | 英语文学全文、批评与书目等学术资源 | 高校和研究机构订阅 | 价格未公开/需询价；检查版权作品是否支持全文挖掘、批量计算和模型训练 |
| [British Newspaper Archive](https://www.britishnewspaperarchive.co.uk/) | 英国历史报纸扫描和文本 | 多为付费订阅/内容许可 | 价格依套餐、访问和授权而变；获取用户可见全文与机器批量语料不是同一权益 |
| [Corpus of Contemporary American English（COCA）](https://www.english-corpora.org/coca/) | 当代美国英语的多体裁语料，与历史语料共同用于比较语言变化 | 免费访问、额度或高级功能按网站规则变化 | 不应假设可下载全量语料用于商业预训练；具体条款和访问层级需核验 |
| [Transkribus](https://www.transkribus.org/pricing) | OCR/HTR、图像分割、标注和自定义模型训练工具服务 | 免费额度、个人/学术/团队/机构方案 | 官方页面列有公开套餐，机构方案需报价；费用是识别与平台服务，不是原始文献授权 |

### 5.1 采购时要问的不是一个“价格”

建议对每个供应商逐项询问：原始图像访问、全文检索、批量下载、OCR 全文、元数据导出、非消费式分析、模型训练、微调、embedding 生成、检索服务、模型权重发布、AI 输出展示、衍生标注再分发、团队人数、云端计算、留存周期、终止合同后的数据清理和审计能力。很多数据库只授予“在平台中阅读/分析”的权利，并不提供把全文复制进自建数据湖或托管 LLM 的权利。

没有查到官方公开价格的项目，一律标为“价格未公开/询价”。不应使用论坛的单个采购案例作为准确报价，因为不同高校的历史合同、数据组件与席位可能差异极大。

## 6. 重要论文与项目：具体依赖哪些数据集

以下列表把“论文使用的数据”和“可以用数据复现的项目”放在一起。商业语料论文可能只公开抽样或代码，不代表原始语料可公开复现。

| 论文/项目 | 研究方向 | 使用的数据集或语料 | 复现与解释边界 |
|---|---|---|---|
| Michel et al., *Quantitative Analysis of Culture Using Millions of Digitized Books*（Science, 2011） | “Culturomics”：用海量书籍中的词频研究文化、名词与概念随时间的变化 | Google Books Ngram Corpus | 数据是按年份聚合的 n-gram 计数，不等于完整书籍内容；书籍出版结构与 OCR 变化都会影响曲线 |
| Lin et al., *Syntactic Annotations for the Google Books Ngram Corpus*（ACL 2012） | 给 n-gram 添加词性/语法标注 | Google Books Ngram 的语言数据及词性标注 | 语法标注覆盖范围有限；不可将所有 n-gram 都当作可靠句法分析结果 |
| Rae et al., *Compressive Transformers for Long-Range Sequence Modelling* / PG-19 相关工作 | 长上下文语言建模与记忆机制 | PG-19 等长文档语言建模基准；PG-19 来自 Gutenberg 的约 28,000 本书 | 主要评估长范围预测能力，不直接衡量文学解释能力；跨作品/作者切分比随机 token 切分更可靠 |
| Devlin et al., *BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding*（2019） | 通用文本预训练 | BookCorpus 与英文维基百科 | BookCorpus 含约 11,000 本书，来源和再分发许可并不等同于开放语料；引用模型不意味着能重建原始书籍训练集 |
| Gao et al., *The Pile: An 800GB Dataset of Diverse Text for Language Modeling*（2020/2021） | 预训练数据集组合、来源多样性与模型评估 | The Pile 含 Books3、BookCorpus2、Project Gutenberg、论文、网页和其他子集 | Books3/BookCorpus 等子集有不同的权利与可用性问题；不要把 Pile 视作各来源均允许商用的统一许可 |
| Kandpal et al., *The Common Pile v0.1: An 8TB Dataset of Public Domain and Openly Licensed Text*（NeurIPS 2025） | 用公有领域与开放许可数据训练 LLM，提升数据来源透明度 | 30 个来源、约 8 TB 的开放许可文本，包括书籍、论文、教育资源等 | 是构建可审计开放预训练语料的重要路线，但每个实际使用版本都应保存来源清单与许可证 |
| Bamman, Popat & Shen, *An Annotated Dataset of Literary Entities*（NAACL 2019） | 文学实体识别与嵌套实体 | LitBank：100 部小说、210,532 tokens、文学实体人工标注 | 数据规模有限但质量较高；适合领域监督与评估，而不是直接代表全世界文学 |
| Sims, Park & Bamman, *Literary Event Detection*（ACL 2019） | 文学叙事中的事件识别 | LitBank 的文学文本及事件标注 | 区分真实发生、假设、未来、回忆和叙述性摘要，对事件定义非常重要 |
| Bamman, Lewke & Mansoor, *An Annotated Dataset of Coreference in English Literature*（LREC 2020） | 文学长文档人物共指 | LitBank 中 100 部作品，29,103 个提及，210,532 tokens | 核心挑战是长距离指代、身份揭示、别名和代词，而非新闻式短文共指 |
| Eder, Rybicki & Kestemont, *Stylometry with R: A Package for Computational Text Analysis*（R Journal 2016） | 文体学、作者归属和文本相似性 | stylo 自带 Austen/Brontë 等小说示例语料，也可读入 TEI 或 UTF-8 文本 | 适合做透明的非 LLM 强基线；应控制文类、出版时期、文本长度和编辑版本 |
| Hamilton, Leskovec & Jurafsky, *Diachronic Word Embeddings Reveal Statistical Laws of Semantic Change*（ACL 2016） | 历时语义变化的词向量分析 | 历史词语语料，包括 Google Books 等时间分片数据 | 时间片样本量、语料体裁变化与词向量空间对齐会造成伪变化；应做稳健性检验 |
| Underwood 等数字人文计算文学研究 | 类型、文类、文化史与远距离阅读 | 经常使用 Google Books、HathiTrust、Gutenberg、公开小说集和研究机构语料 | 关注抽样代表性和书籍元数据；大规模文本统计需要与细读、历史语境对照 |
| Living with Machines 项目与 LwMDB | 英国工业化时代社会史、多源历史数据链接 | 历史报纸、地图、人口普查、书刊和馆藏元数据 | 亮点是跨数据源关系建模与空间定位，不是单一 NLP 模型 |
| Newspaper Navigator（Library of Congress） | 对历史报纸页进行图像与版面内容分类 | Chronicling America 的报纸扫描和相关批量数据 | 说明非 LLM 计算机视觉同样能建立有价值的历史数据产品 |
| CLTK / Perseus / Open Greek Corpus | 古典文本分词、形态与词元分析 | 古希腊语、拉丁语与古典文本版本及语言学标注 | 语言学工具与文本来源的许可独立；自动标注要区分人工 treebank 与模型输出 |
| OpenITI 的语料与文本复用研究 | 阿拉伯/波斯历史文本的标准化、文本相似度、文献传播 | OpenITI Corpus 与相关机器可读文本 | 需要保留版本、来源和 OCR/手工转录质量；非商业授权影响部署路线 |

### 6.1 复现论文前先验证数据可得性

做论文复现时，至少区分：

1. 原始文本及标注均可按开放许可下载；
2. 论文公开代码与预处理方法，但原始商业语料必须另行授权；
3. 只能下载研究衍生特征，无法获取受版权保护全文；
4. 论文使用内部或未公开语料，仅可复现方法或公开测试子集；
5. 有数据下载入口，但许可证不足以支撑目标商业用途。

例如，LitBank 可用于文学实体和共指任务的领域标注评估；HathiTrust 的大规模 BookNLP 衍生数据让研究者有机会做跨书统计，但它不提供版权内图书的自由全文下载；PG-19 提供长文档 benchmark，但不应把它误当作完整、跨国、可任意商用的小说库。

## 7. 非 LLM 项目清单：传统 NLP、机器学习、文体学与数字人文

这里的“非 LLM”是指项目的核心分析不依赖生成式大语言模型。部分工具可能使用传统统计模型、分类器、词向量、CRF、规则系统或专用神经网络。

| 项目/工具 | 核心能力 | 推荐数据集 | 典型用例 |
|---|---|---|---|
| [BookNLP](https://github.com/booknlp/booknlp) | 文学文本专用 NLP：人物聚类、共指、对话归属、事件和词语标注 | Gutenberg、LitBank；HTRC BookNLP ELF 衍生数据 | 小说角色库、别名归一、人物网络、角色出场/对白统计 |
| [LitBank](https://github.com/dbamman/litbank) | 文学实体、事件、共指与引语标注基准 | LitBank 原始小说样本 | 训练/评测文学 NLP，量化通用新闻模型在小说上的领域差距 |
| [stylo](https://github.com/computationalstylistics/stylo) | R 语言文体学、词频特征、距离度量、聚类与作者归属 | Gutenberg、开放莎士比亚文本、公开小说、研究语料 | 作者归属、伪作辨识、文体聚类和稳健性分析 |
| [MALLET](https://mimno.github.io/Mallet/) | LDA 等主题模型、文档分类和序列建模工具 | Gutenberg、报刊 OCR、历史期刊和档案文本 | 分析长期语料主题变化，比较主题与年代、地区、文类之间关系 |
| [Voyant Tools](https://voyant-tools.org/) | 浏览器端语料探查、词频、共现、趋势和可视化 | 用户自有文本、公开文学、历史档案 | 文学课堂、快速 EDA、探索性远距离阅读 |
| [AntConc](https://www.laurenceanthony.net/software/antconc/) | 关键字、搭配、词表、KWIC concordance 和语料比较 | 可合法使用的文本语料 | 传统语料语言学、人物称呼、词语语境与搭配研究 |
| [Gensim](https://github.com/piskvorky/gensim) | Word2Vec、Doc2Vec、主题建模等 | Gutenberg、COHA 的授权子集、跨年代书籍语料 | 非 LLM 词向量、文档相似性和语义变化基线 |
| [spaCy](https://spacy.io/) / [Stanza](https://stanfordnlp.github.io/stanza/) | 分词、句法、实体与语言处理 pipeline | 文学文本、书信、报刊以及带标注的历史文本 | 为角色关系、人物地点抽取和检索建立基础 NLP 层；需评估历史语言域偏移 |
| [Classical Language Toolkit](https://github.com/cltk/cltk) | 古典/前现代语言的词法和语言分析 | Perseus、Open Greek Corpus、OpenITI 等 | 古典语言的词元、形态、字符与文本研究 |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | 印刷文字识别 | 历史报纸、扫描书籍、公开 OCR 数据集 | 现代印刷体与历史印刷体 OCR 基线；老字体通常需定制训练和后处理 |
| [Kraken](https://github.com/mittagessen/kraken) | OCR/HTR、行识别和版面文字识别 | Bentham、READ、Saint Gall、历史书籍与手稿数据 | 训练特定手写体/印刷体模型和批量识别 |
| [eScriptorium](https://gitlab.com/scripta/escriptorium) | 开源协作式文档分割、转录、HTR 与模型训练接口 | 手稿、档案、书信和历史文书图像 | 将人工校订转成可复用 ground truth，并维护图像—文字对齐 |
| [OCR-D](https://ocr-d.de/) | 面向历史印刷品的模块化 OCR workflow | 历史书籍、版面和 OCR 基准 | 质量评测、可配置识别步骤和可重复的历史文献处理 |
| [Transkribus](https://www.transkribus.org/) | 托管 HTR/OCR、版面分析和团队校订 | 历史文书与公共训练集 | 适合低代码协作和定制模型，但需考虑积分成本、数据出境和许可证 |
| [Newspaper Navigator](https://data.labs.loc.gov/explorations/) | 报纸图像中的照片、插图、地图、广告等图像内容分类 | Chronicling America 扫描图像 | 将文本语料扩展为多模态历史数据，构建图像—文字联合索引 |
| [TEI Publisher](https://teipublisher.com/) / [oXygen XML](https://www.oxygenxml.com/) | TEI/XML 文本编码、学术版面发布与搜索 | 文学版本、校勘本、手稿转录 | 构建可引用的数字学术版本和文本/原图对齐 |
| [Recogito](https://recogito.pelagios.org/) | 人物/地名注释、地理实体标记和协作式地名标注 | 历史文本、旅行日志、手稿、地图 | 为历史地点解析、历史 GIS 和知识图谱提供人工校订标签 |
| [AntConc、TXM、Sketch Engine / NoSketch Engine](https://www.sketchengine.eu/) | 语料检索、搭配和语言分布分析 | 授权文学/历史语料、开放文本 | 语料语言学、词语语境和多文类比较；部分服务可能有商业费用 |

不要低估这些传统工具的价值。词频/搭配分析、作者归属、规则化字符识别、实体链接和文本复用仍然可以在很多任务中建立可解释且便宜的基线。LLM 应当与这些方法比较，而不是默认替代它们。

## 8. LLM 项目与可以使用的语料

LLM 在文学与历史任务中主要可以承担四类工作：文本理解与问答、长篇上下文检索、人工标注辅助、以及在授权语料上进行继续预训练/微调。不同路线对数据要求完全不同。

| LLM 项目/框架 | 能做什么 | 可对应的数据集 | 重要边界 |
|---|---|---|---|
| [Hugging Face Transformers](https://github.com/huggingface/transformers) + [Datasets](https://github.com/huggingface/datasets) | 加载现成模型、训练/微调文本模型、做分类/实体识别/问答和数据处理 | PG-19、经许可的 Gutenberg 书籍、LitBank、Common Pile、公开历史语料 | 框架开放不等于语料许可证开放；需保留 dataset card、版本、训练 split 和来源清单 |
| [LlamaIndex](https://github.com/run-llama/llama_index) | 将文学、史料、注释、元数据与图像 OCR 结果构造成可检索索引和 RAG 查询系统 | Gutenberg、Chronicling America、合法导出的数字学术版本、Open Greek Corpus | 对版权内语料应在许可允许的环境中建索引；embedding 本身可能是衍生数据，不能默认自由分享 |
| [LangChain](https://github.com/langchain-ai/langchain) | 组织加载、切分、检索、工具调用、对话状态和答案引用链 | 书籍、历史报纸、档案及研究机构允许的全文/元数据 | 不能只以 token 长度切分；应保留页码、章节、文本版本和证据来源 |
| [Haystack](https://github.com/deepset-ai/haystack) | 搜索、RAG、文档索引与问答 pipeline | 同上，可组合全文、书目和 OCR/HTR 数据 | 应把原始文本、人工校订、模型生成摘要和来源证据分别存储 |
| [DSPy](https://github.com/stanfordnlp/dspy) | 优化信息抽取、分类、摘要、引用问答等 LLM pipeline | LitBank、人工校订的历史实体与事件标签、少量高质量评测集 | 数据集要为 prompt/program 优化与最终测试分开；不可把测试答案反复用于调参 |
| [Open WebUI](https://github.com/open-webui/open-webui) / [Ollama](https://github.com/ollama/ollama) / [llama.cpp](https://github.com/ggml-org/llama.cpp) | 私有化、本地模型运行与文档问答 | 自有授权小说库、公共领域历史文本、馆藏研究副本 | 本地推理降低数据外传风险，但不解决原始语料版权、用户访问控制和日志留存问题 |
| [RAGAS](https://github.com/explodinggradients/ragas) 与检索评估工具 | 检查检索质量、上下文相关性和回答支持程度 | 人工构造的史料问答、带引用的 LitBank/公开史料任务集 | 自动评价器不能替代史料来源核查；应额外检查引文可定位、引述是否逐字一致及是否存在虚构来源 |
| [Common Pile / Comma](https://proceedings.neurips.cc/paper_files/paper/2025/hash/52acc050138d6f40dad6f12f91a4ce22-Abstract-Datasets_and_Benchmarks_Track.html) | 以公有领域和开放许可语料训练 LLM 的数据与模型范例 | Common Pile v0.1 的开放文本混合 | 值得作为开放训练数据的参考路线；在实际训练前仍应看当前版本 source manifest 和各内容许可 |
| [CLTK 可选的生成模型后端](https://github.com/cltk/cltk) | 在古典语言 NLP pipeline 里调用远端或本地生成模型 | Open Greek Corpus、Perseus、OpenITI 以及许可兼容的翻译/注释 | 自动翻译、词源解释和总结是模型输出，不是权威词典或原始史料；必须能回到来源段落 |

### 8.1 文学/历史 RAG 的关键不是向量数据库，而是证据结构

对于一本小说或一组历史档案，不建议只按固定 500 tokens 切块、删除全部元数据，然后建立向量索引。至少应有如下层级：作品/档案、版本/馆藏对象、卷册、章节/事件、页/段/行、片段。每个 chunk 要保留稳定 ID、原始文件 ID、页码/位置、标题、作者、日期范围、语言、版本和许可证。

如果用户问“第 5 章第一次出现的某角色是谁”，系统需要知道章节边界、别名归一、共指信息和原始文本位置。若用户问“这份 1840 年的报纸如何描述某次事件”，系统还需要出版时间、发行地、报纸标题、页面图像、OCR 可信度和历史语境。RAG 召回的文本只是候选证据；答复必须允许回到原文或图像。

### 8.2 微调或预训练的语料选择建议

- 做长文档建模或上下文记忆研究：从 PG-19 和明确许可的开放长篇文本开始，按作品划分训练/测试，避免同一本书的相邻片段泄漏。
- 做角色识别、共指或引语归属：优先用 LitBank 做基准，以 BookNLP 建立强基线，再使用有版权许可的目标文类补充人工标注。
- 做古籍/历史档案 OCR 或 HTR：使用与文字形态、语言和版式相近的历史图像基准，再做小规模人工校订微调；通用 LLM 不应替代专用 OCR/HTR 评测。
- 做历史事件抽取：用 Chronicling America、Old Bailey、历史报刊或经许可的档案文本，定义“事件日期”“文本发布日期”“来源记录时间”三种时间。历史文本常记述更早发生的事件，不能直接把文档日期当事件日期。
- 做继续预训练：优先选来源、许可证、去重方法和过滤规则可解释的开放语料组合。不要把 Books3 或 BookCorpus 这类权利存在争议的语料当作默认基线，更不能认为开源模型权重使源书籍版权问题自动消失。
- 做模型评估：训练和调参集必须与测试集在作品、作者、时间或档案集合层面隔离，而不只是按段落随机抽样。

## 9. 文学与历史数据的采集、清洗和版本标准

### 9.1 建议的数据流水线

1. **来源与权利登记。** 保存馆藏机构、数据集名称、URI/DOI、下载日期、数据版本、许可证、权利声明、允许用途、地域限制、是否允许 AI 训练、是否允许商业使用以及联系渠道。
2. **原始层（Raw/Bronze）。** 原样保存扫描图、下载文件、HTML/XML/JSON、原始 OCR 和原始元数据，记录 SHA-256、响应时间、API 查询条件和源 URL，不覆盖旧版本。
3. **数字化层。** 如果仅有图像，运行版面/区域检测、行分割、OCR/HTR，保留识别模型版本、置信度和页面坐标，并抽样进行人工 QA。
4. **转录与编码层。** 将 OCR、校订文本、外交式转录、规范化文本、脚注、编辑者补字、删改痕迹和语言注释放在可区分的层次里。
5. **规范数据层（Canonical/Silver）。** 归一化作品、版本、作者、实体、时间、地点、语言和来源 ID；保留 alias、uncertainty、provenance 和历史映射。
6. **语料/特征层（Gold）。** 根据任务生成段落、诗行、章节、事件窗口、标签、embedding 或训练样本；每个样本都能追溯回具体作品版本和页/行位置。
7. **评估与发布。** 发布数据集版本号、卡片、许可、schema、采样方法、质量统计、测试集定义、处理代码和引用方式；数据或标注变更应生成新版本。

### 9.2 核心元数据和数据契约

推荐每个作品/文件/片段至少记录下列相关字段：

| 字段组 | 典型字段 | 作用 |
|---|---|---|
| 标识 | work_id、edition_id、manifestation_id、witness_id、source_record_id、page_id、chunk_id | 区分作品、版次、见证本、扫描文件和索引片段 |
| 书目 | title、author_id、contributor、publisher、publication_place、publication_date、edition_statement、series、ISBN/DOI | 支持书目查重与不同版本关联 |
| 历史时间 | created_at、event_date、publication_date、date_range_start/end、date_precision、calendar_system | 区分作品创作、出版、文书记录与描述事件发生的时间 |
| 地理/实体 | place_id、authority_id、entity_id、aliases、language_specific_name、valid_from/to | 支持同名消歧、历史地名和人物关系 |
| 文本来源 | source_uri、IIIF manifest/canvas、page image URL、OCR/HTR model、transcriber、confidence、revision_id | 把文本重新连接到影像和识别/校订过程 |
| 文本结构 | volume、chapter、scene、stanza、line、paragraph、footnote、speaker、editorial_note | 防止切分或抽取丢失文学结构 |
| 权利 | license_id、rights_statement、jurisdiction、ai_training_allowed、commercial_use_allowed、redistribution_allowed、retention_until | 防止数据被错误地用于模型训练或外部服务 |
| 质量/血缘 | checksum、schema_version、ingested_at、transform_commit、quality_flags、ocr_error_rate、source_version | 确保可重复构建和问题追查 |

不要把 work、edition、digital item 和 text chunk 用同一个 ID 表达。例如《傲慢与偏见》原作、某个校勘本、某个公共领域电子版、某个重新排版 PDF、某个 OCR 文件与一段 RAG chunk，应该能够分别追踪。

### 9.3 标准、格式与框架

| 标准/工具 | 主要作用 | 适合的内容 |
|---|---|---|
| [TEI P5](https://tei-c.org/guidelines/) | XML 方式表达文本结构、版本差异、注释、人物、时间、校勘和学术版本 | 文学、历史、书信、手稿和数字学术版 |
| [IIIF](https://iiif.io/) | 标准化访问与呈现高分辨率图像、manifest、canvas 和注释 | 古籍、报纸、手稿、地图及文字—图像定位 |
| [ALTO XML](https://www.loc.gov/standards/alto/) | 表达 OCR 后文本、版面区域、文字行和坐标 | 报纸、扫描书籍和批量 OCR |
| [PAGE XML](https://github.com/PRImA-Research-Lab/PAGE-XML) | 文档图像版面与识别结果的结构化表示 | 历史手稿、版面分区、行/字坐标与训练标注 |
| [METS](https://www.loc.gov/standards/mets/) | 描述数字对象的结构、文件关系与组织方式 | 多页书籍、馆藏数字对象、影像和 OCR/全文关联 |
| [MODS](https://www.loc.gov/standards/mods/) / [MARC](https://www.loc.gov/marc/) | 书目元数据 | 图书、版次、作者、出版地和馆藏编目 |
| [PREMIS](https://www.loc.gov/standards/premis/) | 数字保存、对象、事件、代理者和权利元数据 | 档案的数字保存与转换血缘 |
| [EAD](https://www.loc.gov/ead/) | 档案馆层级描述与 finding aids | fonds、series、box、folder、档案层级关系 |
| [Dublin Core](https://www.dublincore.org/specifications/dublin-core/dces/) | 通用资源描述的元数据元素 | 跨馆目录互操作和数据发现 |
| [CoNLL-U](https://universaldependencies.org/format.html) / Universal Dependencies | 词、词元、词性、形态和依存句法表示 | 需要句法/形态标注的历史与古典语料 |
| [Hugging Face Datasets](https://github.com/huggingface/datasets) | 训练数据加载、切分、流式读取与 dataset card 生态 | 经过许可审查的语料和标注数据 |
| [DVC](https://dvc.org/) / [lakeFS](https://lakefs.io/) / 对象存储版本化 | 数据文件版本、manifest 和处理流水线复现 | 体量大、迭代清洗、图像与文本混合的数据项目 |

TEI 尤其重要，因为它允许把作品内容与学术解释分开编码。例如删节、插入、编辑补字、异文、脚注和人物标记可以作为结构保存，而不是在文本清理时直接删除。TEI Guidelines 是面向人文研究文本的开放规范；其扩展性有利于版本化和跨项目交换。[TEI 官方指南](https://tei-c.org/guidelines/)。

### 9.4 清洗文学与历史文本时最容易发生的错误

**过度清洗。** 删除所有标点、章节标题、诗行与脚注，会让作者归属、对白分析、诗歌结构和版本学研究无法复现。建议保留原始层、标准化层及各自的清洗规则。

**混淆 OCR 与原文。** OCR 中的“rn”/“m”、长 s、破折号、分栏顺序、页码和脚注错误都可能改变实体与事件。OCR confidence 是模型自身的信号，不是正确率保证；必须用人工抽样计算 CER/WER，并按时期、印刷体、语言和版式分组。

**作品与版本混淆。** 同一书名可能对应多种版本、翻译、删节与编辑校订；全文去重不能只靠标题。应比较书目标识、文本相似度、章节结构和版本声明，保留 edition-level 关系。

**对历史语言过早现代化。** 统一拼写会破坏语言演变信号；不统一又可能让检索与实体解析困难。正确做法通常是双轨保存原始拼写和 normalized form，并记录映射规则和版本。

**把编辑文字混入作者文字。** 前言、脚注、现代介绍、馆藏记录、页眉页脚、编辑补字和文本正文应可区分。否则文体模型有可能识别的是编辑者而不是作者。

**错误处理匿名作者、合著和伪作。** 训练作者归属模型前应定义标签依据，记录归属可信度、年代范围、合著情况与学术争议；不要把争议文本简单标成绝对金标准。

**忽视多语种编码与形态。** NFC/NFKC、全角/半角、旧字形和组合字符的规范化可能影响文本；多语种应使用稳定 Unicode 处理，同时保留原图及原始字形。

**跨时期随机切分造成泄漏。** 对同一本书按段落随机分训练和测试，会使模型记住人物、场景与固定用语。应优先按作品、作者、版本、报刊标题或年份分组，并报告跨作者/跨年代泛化。

**未经授权的全文/embedding 外发。** 把订阅内容送入外部 LLM API、建立公开向量库或将提取结果用于商业接口，可能超出原始授权。要审查供应商条款、子处理者、日志保留、训练数据使用政策和派生数据定义。

## 10. 数据抽样、标注和评估：从研究语料走向可靠模型

### 10.1 抽样设计应反映研究问题

如果目标是理解小说中人物对话，抽样要覆盖对话密度、文类、时代、作者和叙事方式；如果目标是历史概念变化，抽样应覆盖不同年代、地区、出版类型和文体，而不是只抽取最热门书籍；如果目标是手稿识别，测试集要覆盖真实部署中会出现的手写风格、纸张、墨水、扫描分辨率和语言。

建议在 dataset card 里公开：纳入/排除标准、作品/作者/年代分布、重复作品处理、书籍版本策略、字符编码、语言判定方法、OCR/HTR 生成方式、人工校订比例以及对缺失材料的偏差说明。

### 10.2 标注策略

文学与历史实体的标签定义往往需要领域专家。人物可以是实际历史人物，也可能是虚构角色；事件可以是现实事件、小说中的事件、传闻、假设、回忆或未来计划；同一称呼可能指向不同实体；同一历史人物也可能随年代变更头衔。应先编写标注指南，再选择一小批代表文本做试标和冲突讨论，随后执行双人标注和一致性评估。

建议至少记录 annotation_id、annotator_id、guideline_version、label、evidence_span、confidence、adjudication、adjudicator、timestamp 和 source_version。自动标签应标记为 model-predicted，而不是和人工金标准混为一谈。

### 10.3 评价指标与实验隔离

| 任务 | 建议指标 | 常见错误 |
|---|---|---|
| OCR/HTR | CER、WER、按文档/语言/版式分组的识别率 | 只报告平均 WER，忽略难文档或日期/人名错误 |
| 人物/地名实体识别 | Precision、Recall、F1、span exact match | 用新闻模型在小说上的结果直接下结论 |
| 人物共指与别名归一 | CoNLL F1、B³、CEAF、角色 identity accuracy | 将章节级别名聚类错误扩散到整本书 |
| 事件抽取/时间线 | span/trigger F1、argument F1、temporal ordering accuracy | 把出版日期当成文内事件发生日期 |
| 作者归属/风格分类 | Accuracy、Macro-F1、开放集识别与校准、跨作品测试 | 文本长度、主题或出版编辑差异冒充作者风格 |
| 历时语义变化 | 时间片稳定性、邻居/相似度变化、对齐稳健性、人工语义检验 | 把语料变化、OCR 错误当作词义改变 |
| 文学/史料 RAG | Recall@K、MRR/nDCG、证据覆盖率、引用可定位率、答案正确性 | 只让 LLM 给自己打分，不检查原文与引文 |
| 书籍/档案分类与主题模型 | Macro-F1、主题稳定性、bootstrap 稳定性、专家解释性 | 对不同年代样本不平衡和文类偏差不做控制 |
| 长文档语言模型 | perplexity、token-level loss、长程上下文分桶评测 | 训练与测试片段来自同一本书或相同版本 |
| 生成式翻译/摘要 | 人工事实核查、术语一致性、文风/语域评估、引文核验 | 只看流畅度，忽略历史背景、否定、引语和版本差异 |

数据集发布应采用固定、可引用的版本。若需要更新 OCR、合并版本或修订标注，产生新数据版本和变更记录，不要静默覆盖论文中已经使用的数据。

## 11. 可落地的应用清单：哪些项目可以怎样用这些数据

| 应用项目 | 主要数据来源 | 适合使用的方法 | 可交付成果 |
|---|---|---|---|
| 个人小说阅读助手 | 授权的 EPUB/TXT、Gutenberg 作品、BookNLP 结果 | 传统章节索引 + 角色别名图 + RAG + 本地 LLM | 章节问答、角色表、伏笔检索、原文定位和阅读笔记 |
| 长篇小说人物与叙事分析 | LitBank、Gutenberg、HTRC ELF 或许可小说库 | BookNLP + 共指/事件模型 + 图分析；LLM 用于人工确认候选关系 | 人物关系网络、角色出场轨迹、对白分布、事件时间线 |
| 文学风格/作者归属研究 | 公共领域小说、stylo 示例语料、莎士比亚文本和学术授权文本 | 字频、n-gram、Delta、SVM/随机森林和文本嵌入对照 | 作者归属、伪作筛查、风格相似度与稳健性报告 |
| 历时语义与文化趋势 | Google Books Ngram、COHA、CEEC、Gutenberg 元数据与文本 | n-gram、词向量时间片、主题模型和统计检验 | 某概念/词语随时间变化的曲线与语料证据 |
| 历史人物知识图谱 | CBDB、Wikidata、OpenITI、Old Bailey、历史档案和书信 | 实体识别、同名消歧、规则 + 图算法，LLM 辅助候选核查 | 人物别名、任职、亲属/交往关系、时间有效的知识图谱 |
| 历史报刊搜索引擎 | Chronicling America、Europeana Newspapers、Gallica、Trove 或授权报纸 | OCR/HTR + BM25 + 向量检索 + 元数据过滤 | 可按地点、时间、报纸、事件检索并回到原始页面的搜索系统 |
| 历史档案数字化平台 | 馆藏图像、手工转录、READ/Bentham 等基准 | IIIF + eScriptorium/Kraken/Transkribus + TEI/PAGE/ALTO | 可引用的图像—转录对齐、检索与研究版 |
| 古典语言学习与研究 | Perseus、Open Greek Corpus、CLTK、OpenITI | 词法分析 + 词典/语法检索 + 小型本地 LLM | 逐句语法辅助、词元检索、版本差异和译文对齐 |
| 古籍识字与文本恢复 | CODH Kuzushiji、古籍图像、人工标注数据 | CNN/ViT 字符分类、行识别、HTR 和人工校正 | 旧字形识别、古籍 OCR pipeline、质量评估 |
| 历史文献问答 RAG | 授权报纸全文、档案、校勘本及其来源元数据 | 关键词检索 + 向量检索 + reranker + LLM 引文生成 | 可追溯的问答与时间线，附原件、页码、日期和不确定性 |
| LLM 开放语料预训练 | Common Pile、允许使用的 Gutenberg 文本与其他开放许可语料 | 过滤、去重、数据混合、继续预训练和领域评估 | 可复现的研究模型和公开训练 manifest |
| 教育/数字人文工作台 | Voyant、AntConc、TEI、公开文本和教学标注集 | 可视化、传统 NLP、标注与 LLM 辅助解释 | 可解释的语料探索环境、教学数据和课程项目 |

一个相对低风险的原型组合是：用 Project Gutenberg 中许可证明确的作品做长篇阅读检索；用 LitBank 验证人物实体/共指；用 BookNLP 建立角色分析基线；用本地 LLM 做基于原文引用的问答；用一小批人工审核问题来评估角色归一、章节边界和引用忠实度。对于历史档案，则从 Chronicling America 与 OCR 基准开始，先验证图像—OCR—页码—来源全链条，之后再接入受控的商业馆藏。

## 12. 量化历史（Quantitative History）：数据集、论文与研究方法

量化历史是本综述与文学、历史语料相邻、但研究目标不同的关键方向。它不是“把历史文本交给模型做统计”这么简单，而是把历史学中的来源批判、计量经济学、统计推断、人口统计、地理信息系统与数据工程结合起来，从不完整、口径不同、随时间变化的史料中构建可分析的数据，并对历史变化提出可被证据检验的解释。

相关术语有重叠但并不完全等同：

| 名称 | 核心问题 | 典型方法与数据 |
|---|---|---|
| Quantitative History / 量化历史 | 如何从过去的可量化证据中研究长期社会、政治、经济和文化变化？ | 历史统计表、人口与税册、价格和工资序列、面板数据、空间数据、网络数据、统计模型和因果推断 |
| Cliometrics / 计量经济史 | 历史经济学中的理论建模、量化证据和统计推断如何共同检验经济解释？ | 历史国民账户、工资/价格、贸易、金融数据、计量经济学、自然实验与制度分析 |
| Computational History / Digital History | 如何利用计算技术处理史料、探索大规模文本、建立数字馆藏、检索/映射/可视化历史证据？ | OCR/HTR、NLP、文本挖掘、地理分析、实体解析、数字版本、可视化与网络分析 |
| Historical Social Science | 历史制度、社会结构、文化和冲突如何产生长期影响？ | 历史边界、制度和人口数据与现代结果合并；比较历史分析、事件研究和机制分析 |
| Historical Data Science | 如何将史料转化为可复现、可审计、可被多学科复用的数据产品？ | 来源血缘、版本化、数据契约、抽样/测量误差、实体/地名规范、开放数据和计算工作流 |

经典定义可参考 [EH.net 的 Cliometrics 介绍](https://eh.net/encyclopedia/cliometrics/)。它强调量化证据、理论概念、统计估计以及历史学家判断来源质量和历史语境的能力必须结合；没有可信来源和历史解释，复杂的模型也不能把不可靠数据变成可靠结论。

### 12.1 量化历史核心数据集

| 数据集/项目 | 数据范围 | 许可、获取和价格概况 | 主要研究问题 |
|---|---|---|---|
| [Maddison Project Database 2023](https://www.rug.nl/ggdc/historicaldevelopment/maddison/releases/maddison-project-database-2023?lang=en) | 169 个国家，GDP/人均收入与长期经济发展指标，最新公开版本覆盖至 2022 年；跨国长时段历史国民账户重建 | 官方研究项目公开发布，可下载数据；必须引用对应版本和原始来源，不要把估算值视为精确观测 | 大分流、长期增长、跨国收入差异、工业化与全球不平等 |
| [GGDC Historical National Accounts](https://research.rug.nl/nl/datasets/ggdc-historical-national-accounts/) | 19–20 世纪历史国民账户，可追踪不同行业的 GDP、现价和不变价估计；记录覆盖约 1835–1959 年 | 大学研究数据门户公开发布版本，逐项核对文件和引用要求 | 产业结构变化、部门生产率、长期增长来源 |
| [Jordà–Schularick–Taylor Macrohistory Database](https://www.nber.org/research/data/jorda-schularick-taylor-macrohistory) | NBER 页面介绍的版本覆盖 17 个发达经济体、1870 年以来的年度数据和 45 个实际/名义变量，包括私人部门信贷、按揭、房价及股票/债券/票据长期回报 | NBER 页面公开提供研究数据库；版本与变量数会变，分析时必须固定版本并保留数据说明 | 信贷周期、资产价格、金融危机、住房与宏观经济之间的长期关系 |
| [NBER Macrohistory Database](https://www.nber.org/research/data/nber-macrohistory-database) | 第一次世界大战前与两次世界大战之间的经济指标，包含生产、建筑、就业、货币、价格、资产市场交易、贸易和政府活动；许多序列为月度或季度 | NBER 免费研究数据入口；不同序列的来源和单位不一 | 金融危机、通胀、货币政策、商业周期和资产市场的历史对照 |
| [Global Price and Income History Group（GPIH）](https://gpih.ucdavis.edu/Datafilelist.htm) | 长时段商品价格、工资和生活水平资料；覆盖欧洲以及中国、日本、南亚和美洲的若干历史价格/工资序列；部分价格数据可追溯至约 1260 年 | 网站列出多份可下载数据文件和研究成果；每份数据的单位、覆盖与论文来源不同 | 实际工资、生活水平、长期价格、消费者篮子、跨国成本和历史通胀 |
| [EH.net Economic History Databases](https://eh.net/databases/) | 早期美国证券价格（1790–1860）、商品价格、公共债务、历史劳动力统计、银行和国债交易、历史贸易以及 TRF-GIS 等多类专题数据 | 许多系列直接免费获取；目录也会链接到其他来源或商业数据库 | 历史金融、商品市场、货币制度、劳动、贸易与空间经济史 |
| [World Inequality Database（WID.world）](https://wid.world/) | 国家内部与国家之间的收入和财富分布，整合税收、家庭调查、国民账户及其他历史来源；部分国家财富不平等序列延伸至 1820 年 | 可公开浏览和下载多类数据及方法说明；不同数据系列有其来源和质量等级 | 财富/收入集中、分配制度、阶层和性别差异、长期不平等 |
| [IMF Public Finances in Modern History](https://www.imf.org/external/datamapper/profile/MMR) | 历史公共财政数据，研究文献介绍了 55 国、部分系列从 1800 年开始的预算、赤字和政府债务序列 | IMF 提供历史指标和国家数据视图；具体变量定义、覆盖和下载方式按指标核对 | 国家能力、公共债务、财政制度、战争融资与主权债务风险 |
| [Global Macro Database（NBER Working Paper 33714）](https://www.nber.org/papers/w33714) | 将当代 32 个主要来源和 78 个历史数据集整合为全球宏观年序列；论文介绍 243 个国家、46 个变量 | 论文和项目的可用版本与许可需以原始项目说明为准；这是动态更新的数据产品，应固定版本 | 全球宏观长期对比、宏观变量复现和历史—现代数据融合 |
| [Global Commodity Database / GPIH](https://gpih.ucdavis.edu/) | 按地区、货币和商品组织的历史价格数据，部分系列约从 1260 年到 1914 年 | 开放研究数据入口；来源、观测频率和缺失结构不同 | 历史通胀、实际工资、贸易网络和生活成本 |
| [SlaveVoyages](https://www.slavevoyages.org/voyage/about) | 跨大西洋奴隶贸易数据库包含超过 36,000 次航行记录；相关论文描述了 258 个变量，覆盖船舶、航程、被奴役者、日期、船员、贸易结果及来源 | 可在线查询并提供研究数据；必须保留下载版本、字段定义、来源与不确定性记录 | 强迫迁徙、人口损失、殖民贸易、非洲与大西洋社会的长期经济影响 |
| [IPUMS International](https://international.ipums.org/international/) | 跨国协调后的历史和现代人口普查微观数据；项目页面介绍覆盖 100 多个国家、数百份人口普查/调查及超过十亿条个人记录 | 免费申请式研究访问，但用户需要遵守项目的数据使用协议；具体协议可能禁止商业用途，不能直接用于商业客户产品 | 历史人口、职业结构、城市化、迁移、教育、家庭与代际流动 |
| [IPUMS NHGIS](https://www.nhgis.org/) | 美国人口、住房、农业和经济统计表以及可用于 GIS 的历史边界；系列时间从 1790 年起，按数据类型和地理版本提供 | 可免费申请与下载；按项目数据使用条款和引用指南使用 | 城市化、历史行政区、选区、人口空间分布与政策效果 |
| [Correlates of War（COW）](https://correlatesofwar.org/) | 国家体系、战争、军事化国家间争端、联盟、贸易等国际关系历史数据；例如 MIDs v5.0 覆盖 1816–2014 年 | 项目强调免费公开、数据记录和复制研究；每个数据集有自己的 codebook 和版本 | 战争成因、联盟与冲突、贸易/战争关系、国际体系长期变化 |
| [TRF-GIS：法国第三共和国历史 GIS](https://eh.net/database/the-trf-gis-a-geographic-information-system-of-third-republic-france-1870-1940/) | 1870–1940 年法国年度行政区名称表与 shapefile，覆盖省、区、县以及选举、司法、军事、教育和劳动监察等边界 | 项目数据可获取，需引用数据说明与论文；空间边界随时期变化是研究的一部分 | 历史行政边界、制度差异、地方政策、空间回归和历史地理 |
| [Seshat: Global History Databank](https://github.com/datasets/seshat) | 将历史社会/政体的政治组织、社会复杂性、战争、人口和制度属性编码为跨地区、跨时期数据 | 可下载不代表开放商用；相关版本标有 CC BY-NC-SA 等非商业限制，应核对当前发布版本 | 国家形成、社会复杂性、制度演变、文化演化和比较历史分析 |
| [Database of Religious History](https://religiondatabase.org/landing/about) | 对历史宗教传统与社会文化实践进行结构化量化，并附有质性评论、来源和进一步阅读链接 | 提供线上检索与分析能力；导出与再利用条件需按项目政策核查 | 宗教制度、仪式、社会组织、文化比较和历史知识整理 |

其中最适合作为入门组合的是 Maddison Project（长期跨国增长）、GPIH（生活成本与工资）、JST Macrohistory（现代金融化之前后的信贷与资产价格）、NBER Macrohistory（更高频历史经济序列）、IPUMS/NHGIS（人口与空间）以及 SlaveVoyages/COW（迁徙、贸易与冲突）。它们覆盖不同单位和测量目标，不应该不经口径调整就拼进同一张宽表。

### 12.2 重要论文与数据之间的对应关系

| 论文/研究 | 关键数据来源 | 方法与贡献 | 复现时的注意事项 |
|---|---|---|---|
| Bolt & van Zanden, *The Maddison Project: collaborative research on historical national accounts*（Economic History Review, 2014）[DOI](https://doi.org/10.1111/1468-0289.12032)；以及 *Maddison-style estimates of the evolution of the world economy: A new 2023 update*（Journal of Economic Surveys）[DOI](https://doi.org/10.1111/joes.12618) | Maddison Project Database 与各国历史国民账户重建 | 通过国家专家协作整合和修订历史 GDP/人口估计，研究长期经济表现 | 不同国家、早期年代和数据版本的不确定性不同；要引用所用版本并记录估计数据与官方统计的区别 |
| Jordà, Schularick & Taylor, *Macrofinancial History and the New Business Cycle Facts*（NBER Working Paper 22743）[论文](https://www.nber.org/papers/w22743) | JST Macrohistory Database，发达经济体长时段信贷、房价、资产回报和宏观数据 | 将金融周期放入长期历史比较，揭示信贷扩张与危机之间的关联 | 年度数据、国家覆盖和变量构造决定可识别的机制；不要将相关性直接解读为因果 |
| Nunn, *The Long-Term Effects of Africa’s Slave Trades*（Quarterly Journal of Economics, 2008）[论文 DOI](https://doi.org/10.1162/qjec.2008.123.1.139) | 跨大西洋及其他奴隶贸易历史记录、地理与现代经济发展指标 | 将历史强迫迁徙规模与现代结果联系起来，分析长期制度和社会影响 | 来源记录、估算的奴隶贸易量、地区归属和遗漏航程会带来测量误差；相关结果需要结合历史语境解释 |
| Dell, *The Persistent Effects of Peru’s Mining Mita*（Econometrica, 2010）[DOI](https://doi.org/10.3982/ECTA8121) | 西班牙殖民时期 mita 强制劳动制度的历史地理边界，及秘鲁现代家庭和经济结果 | 利用历史制度边界与空间邻近设计研究制度的长期影响，典型地结合空间断点思路 | 需精确重建历史行政/制度边界、空间单位和样本，并检验边界两侧的可比性及空间溢出 |
| Acemoglu, Johnson & Robinson, *The Colonial Origins of Comparative Development: An Empirical Investigation*（AER, 2001）[NBER 工作论文](https://www.nber.org/papers/w7771) | 殖民时期定居者死亡率资料、历史制度指标和现代收入发展指标 | 使用工具变量等方法研究殖民制度与长期发展之间的关系 | 这是计量历史中的经典争论案例。工具变量的排除限制、测量方式、样本与机制一直有讨论，不应当把一个历史工具变量视为自动有效 |
| Dittmar, *Information Technology and Economic Change: The Impact of the Printing Press*（Quarterly Journal of Economics, 2011）[DOI](https://doi.org/10.1093/qje/qjr035) | 欧洲城市、印刷术引入和传播、城市增长及地理信息 | 利用印刷技术扩散的时间/空间差异研究知识技术对经济增长的长期影响 | 地点对齐、技术扩散日期、城市口径变化和同期制度差异是主要数据工程问题 |
| *Historical statistics and the Great Divergence* 相关研究 | Maddison/GGDC/GPIH、工资与价格重建和各国国民账户 | 比较欧亚不同地区的人均产出、工资、生活水平和消费篮子 | 货币换算、购买力平价、消费篮子与劳动口径的可比性通常比模型选择更重要 |
| Turchin 等关于 Seshat 的比较历史研究，如 *Quantitative historical analysis uncovers a single dimension of complexity that structures global variation in human social organization*（PNAS, 2018）[论文](https://www.pnas.org/doi/10.1073/pnas.1714698115) | Seshat 的政体—时间—变量编码，以及历史文献与专家判定 | 比较不同社会的等级、行政、信息系统和组织复杂性 | 变量定义、缺失值、历史年代的区间估计和不同地区证据密度都影响结论；应审查编码者和来源链 |
| 历史金融与证券数据研究 | EH.net 的早期证券价格、NBER Macrohistory、GPIH 商品价格与 JST 长期资产回报 | 长期回报、债务市场、货币制度、商品价格与金融危机对比 | 价格可能是报价、成交价或零散档案；必须记录币种、频率、市场覆盖、存续偏差和名义/实际值定义 |

**如何理解这些研究。** 量化历史最有价值的贡献往往是重建可复用的数据：学者要花大量时间识别历史边界、找到旧价格记录、协调单位、估算遗漏值并验证来源。回归或机器学习只能建立在这些证据工作的基础之上。像 Dell 的研究需要重建制度边界；Nunn 的研究需要尽可能将不完整航程记录转换为可比较的地区暴露量；宏观历史数据库需要协调不同国家的 GDP、信贷、住房和回报口径。这些任务无法单纯依靠文本生成解决。

### 12.3 量化历史常用方法：从描述统计到因果推断

| 方法 | 适合的问题 | 所需数据 | 主要假设与风险 |
|---|---|---|---|
| 描述统计、指数与长期趋势 | 价格、工资、人口、贸易和财富如何随时间变化？ | 有时间戳、单位与来源的历史序列 | 样本和记录保存偏差；指数篮子/基年和名义值的误读 |
| 购买力与实际工资重建 | 不同国家/年代的工人购买力是否可比？ | 工资、价格、工作日、消费篮子与货币换算 | 代表性商品篮子、家庭规模、非现金消费和地域差异 |
| 历史国民账户重建 | 很早以前的 GDP、行业结构和人均收入如何估算？ | 农业产量、贸易、税收、工资、人口、能源或生产数据 | 间接估计与模型假设很强，必须保存误差范围/证据等级 |
| 面板回归与固定效应 | 国家、城市、地区长期差异是否与制度、技术或贸易相关？ | 多地区、多个时点、可比较的变量 | 时间变化混杂、反向因果、测量误差和不均衡面板 |
| Difference-in-Differences / 事件研究 | 某种历史制度/技术在采用前后是否带来差异？ | 可解释处理时间、可比对照组和多个前后观测期 | 平行趋势与处理时间异质性；要检查前趋势、溢出和样本构成 |
| 工具变量（IV） | 历史处理存在内生性时，能否找到外生变化来源？ | 历史工具变量、处理和结果变量 | 相关性与排除限制都需论证；“来自历史”不等于工具变量有效 |
| 地理断点、边界设计与空间回归 | 历史制度边界两侧的长期差异是什么？ | 历史 shapefile、地理定位、边界两侧结果数据 | 边界是否有选择性、空间相关、迁移、制度边界复原误差和空间溢出 |
| 合成控制与匹配 | 某城市/国家/地区发生重大历史事件后，与合理反事实相比怎样？ | 较长的事件前序列和多个候选对照单位 | donor pool 的可比性、预处理拟合质量和小样本不确定性 |
| 网络分析与多层图 | 人物、机构、城市、贸易伙伴、信件和引用如何连接？ | 节点/边及时间、角色、来源与关系置信度 | 文献幸存造成网络不完整；不能将未记录关系视为不存在 |
| 机器学习预测与聚类 | 从历史文本/表格预测类别、发现分组或筛选档案 | 标签、特征、合理的训练测试划分和来源元数据 | 预测准确不等于历史解释或因果机制；跨年代泛化尤其困难 |
| 贝叶斯估计、插补与敏感性分析 | 档案缺失或不确定年代如何反映到结果上？ | 可说明的不确定范围、来源强弱和先验假设 | 插补不确定性必须传播到下游估计，不能只输出一个伪精确数字 |

对历史数据做因果推断时，除了报告系数和显著性，还应说明处理定义、对照组、来源选择、地理边界、样本保留、缺失处理、替代编码、前趋势与稳健性。历史材料无法完整记录全部社会行动，因此量化结果应与史料阅读、来源批判和机制解释相互校验。

### 12.4 量化历史项目的数据工程要点

1. **保留出处和证据类型。** 每条测量值都应连接原始档案/书页/统计表、转录者、编码规则、页码或表号。历史研究数据不是单纯的最终数值，还包含该数值为何可信的证据链。
2. **区分观测、估算与编码。** 将官方统计、研究者重建值、插补值、专家判断和模型预测分别记录。不要把五类值放入同一个变量而不保留类型。
3. **同时保存时间和空间版本。** 历史国家、地区、选区和行政区边界会发生变化。使用 stable ID + valid_from/to + source version，并保存可复算的历史 shapefile/geojson 与映射表。
4. **统一单位但不丢原值。** 保留原始货币、计量单位、名义值、基年、价格平减指数、PPP 口径和转换公式；所有转换应该可追溯。
5. **把不确定性作为字段而非脚注。** 对近似年代、估算人口、缺失贸易量、历史价格和冲突事件，保存上下界、精度等级或可靠度等级。敏感性分析要重新计算这些不确定性对结论的影响。
6. **固定数据版本。** Maddison、JST、WID、IPUMS 等数据会更新。记录下载日期、release、引用、文件哈希、变量字典和代码 commit，防止结果因数据更新而无法复现。
7. **尊重访问与许可条件。** 如 IPUMS 微观数据、大学购买的书籍全文、订阅式 OCR 或商业历史数据库，访问允许不等于允许发布原始数据或训练商用模型；应采用合规的汇总输出与受控计算。
8. **区分历史事实和现代回推。** 一份现代边界上的人口表并不自动代表历史行政区；现代收入与历史制度关联也不自动证明持续机制。明确哪些变量在当时真实被测量，哪些是后人回溯估计。

## 13. 其他相近交叉学科：哪些领域也有数据集、论文和可复用方法？

除量化历史本身，以下学科都把历史材料与一种或多种现代方法结合起来。它们可以复用本文前述的馆藏文本、TEI/IIIF、实体解析、数据血缘和机器学习工程，但各自有不同的证据标准。

| 交叉学科 | 核心问题 | 代表数据集/项目 | 主要方法 | 可用于 AI/ML 的项目 |
|---|---|---|---|---|
| 历史人口学（Historical Demography） | 人口、家庭、婚姻、生育、迁移、职业和寿命如何变化？ | IPUMS International、IPUMS NHGIS、Human Mortality Database、历史普查与教区记录 | 人口统计、队列分析、生命表、生存分析、记录链接、面板与空间分析 | 历史人口预测、迁移实体匹配、家谱/家庭关系图、疾病与寿命趋势分析 |
| 历史地理与 GIS（Historical GIS / Spatial History） | 历史地名、行政边界、交通、土地和制度如何在空间中变化？ | CHGIS、TRF-GIS、NHGIS、地图馆藏、历史地籍与道路数据 | 地理编码、时态 GIS、空间统计、网络最短路径、边界设计和遥感 | 古地名消歧、边界历史重建、地图/文本对齐、事件地理检索 |
| 环境史与古气候（Environmental History / Paleoclimatology） | 气候、土地使用、生态、农业与人类社会如何共同变化？ | [HYDE](https://ourworldindata.org/grapher/population)、[PAGES 2k](https://www.ncei.noaa.gov/products/paleoclimatology)、[Neotoma Paleoecology Database](https://www.neotomadb.org/)、历史气象记录 | 时间序列、贝叶斯重建、空间插值、多代理气候重建、因果面板与地理模型 | 气候—人口关系分析、历史灾害时间线、土地利用变化、文献中的气候事件抽取 |
| 历史流行病学与公共卫生（Historical Epidemiology） | 疫病、死亡率、城市化、医疗政策与人群脆弱性如何随时间变化？ | Human Mortality Database、Short-Term Mortality Fluctuations、历史死亡登记、教区记录、医院与防疫档案、IPUMS | 年龄标准化死亡率、队列/生存模型、时空模型、干预事件研究、文本事件抽取 | 历史死亡趋势研究、疫情档案搜索、疾病术语演变、政策与疫情时间线 |
| 考古计量学与数字考古（Digital Archaeology / Archaeometry） | 遗址、年代、器物、饮食、迁徙与交易如何从物质证据重建？ | [IsoArcH](https://isoarch.eu/)、[Neotoma](https://www.neotomadb.org/)、[Archaeology Data Service](https://archaeologydataservice.ac.uk/)、放射性碳年代与出土物数据 | 放射性碳校准、稳定同位素、GIS、计算机视觉、贝叶斯年代模型与聚类 | 文物图像分类、遗址空间关系、同位素/年代数据统一、跨数据库对象匹配 |
| 历史政治学与冲突研究（Historical Political Science / Conflict Studies） | 国家形成、战争、联盟、殖民、选举和政治制度如何变化？ | Correlates of War、SlaveVoyages、历史选区/GIS、历史条约和议会记录、Seshat | 事件数据编码、网络分析、空间断点、IV/DID、事件史和文本分类 | 冲突时间线、条约实体解析、政治组织演变、历史事件关系图 |
| 比较历史社会学与文化演化（Comparative Historical Sociology / Cultural Evolution） | 制度、宗教、社会复杂性与文化特征如何在社会间传播或持续？ | Seshat、Database of Religious History、WID、历史法典/宗教文本 | 比较历史分析、层级模型、因果图、文化特征编码与网络扩散 | 可解释历史知识图谱、制度变量抽取、跨社会比较和不确定性分析 |
| 历史网络科学与传记学（Prosopography / Historical Network Science） | 人物、家族、机构、书信、任职、贸易和知识传播如何形成关系网络？ | CBDB、Wikidata、SlaveVoyages、书信语料、档案目录、议会/大学名录 | 实体消歧、关系抽取、动态图、社群发现、网络中心性和多层图 | 人物别名库、跨档案人物匹配、关系图谱、历史职业路径和知识传播研究 |
| 历史语言学与社会语言学（Historical Linguistics / Corpus Sociolinguistics） | 词义、语法、拼写、语域和社会称谓如何变化？ | Google Books Ngram、COHA、CEEC、CoRD、Gutenberg、Open Greek Corpus、历史书信 | 词频/搭配、历时词向量、变异分析、文体学、句法树库与语义变化统计 | 词义变化监测、历史翻译词典、语域检测、文本年代判定与语言变化图 |
| 书籍史、出版史与知识史（Book History / History of Knowledge） | 印刷技术、出版市场、图书流通和思想传播怎样扩散？ | EEBO、ECCO、Gutenberg 元数据、Google Books Ngram、馆藏目录、印刷商/出版地数据 | 书目分析、印刷地点 GIS、引用网络、文本复用和扩散模型 | 版本/书目去重、作品传播地图、思想词汇时间线和知识图谱 |
| 经济史与金融史（Economic / Financial History） | 价格、工资、证券、信贷、银行、贸易与财富分配如何演变？ | GPIH、JST Macrohistory、NBER Macrohistory、EH.net、WID、IMF 历史财政数据 | 历史指数、面板计量、时间序列、资产定价、金融周期与事件研究 | 历史价格序列重建、长期收益与通胀分析、金融危机对比和实体匹配 |
| 法律史与计算法学（Legal History / Computational Legal Studies） | 法条、判决、法律概念和司法实践如何发生变化？ | Old Bailey、公开判例/法令、历史议会辩论、法律数字档案、TEI 编码法律文本 | 法律实体识别、引用网络、主题模型、判例链、事件史与语义变迁 | 法律引文图谱、历史判决检索、条文变化对比和司法话语研究 |
| 科学技术史（History of Science & Technology） | 科学概念、专利、发明、论文与技术制度如何演变？ | 科学通信语料、历史专利、论文与引用数据库、博物馆/档案馆目录、印刷史数据 | 引文分析、发明扩散网络、文本相似性、事件抽取与知识图谱 | 科学家关系网、术语演化、专利/论文溯源和技术路线时间线 |

### 13.1 跨学科项目的代表入口

- **[Human Mortality Database](https://www.humanmortality.de/)：** 高质量、协调后的死亡率和人口估计，适合历史人口学、寿命研究与公共卫生。需要遵守注册、引用与数据使用条款，不能将所有输出混作无条件再分发数据。
- **[IPUMS International / NHGIS](https://www.ipums.org/overview)：** 对历史人口普查与空间数据做协调，适合人口、城市、迁移、劳动力和政策研究；微观数据使用需申请并按协议约束用途。
- **[Neotoma Paleoecology Database](https://www.neotomadb.org/) 与 [NOAA Paleoclimatology](https://www.ncei.noaa.gov/products/paleoclimatology)：** 多代理古生态与古气候数据，覆盖跨年际到千年尺度的环境重建；适合环境史和气候—社会研究。
- **[IsoArcH](https://isoarch.eu/)：** 生物考古样本的稳定同位素与考古上下文的协作式数据库，适合饮食、迁徙与遗址研究。
- **[Seshat Data Analysis（Oxford）](https://opensource.digitalscholarship.ox.ac.uk/seshat-dataset-analysis)：** 用 Python 分析 Seshat 历史社会数据的开源工具，适合比较历史和社会复杂性研究；应先核查数据集的非商业许可。
- **[Correlates of War](https://correlatesofwar.org/)：** 提供战争、国家间争端、联盟与国际关系的结构化历史数据，项目强调代码本、数据可靠性和复制研究。
- **[World Inequality Database](https://wid.world/)：** 提供收入/财富分布、方法说明和不同历史时期的系列；数据使用应保留其来源与不平等估算方法。
- **[Global Price and Income History Group](https://gpih.ucdavis.edu/)：** 连接经济史、消费史、劳动史、亚洲史与金融史的历史价格和工资数据。
- **[TRF-GIS](https://victorgay.netlify.app/project/trf_gis)：** 将历史行政区边界与标准化年度地名表结合，适合作为时态 GIS 和地理边界版本管理的样板。

### 13.2 哪些跨学科方向最适合与文学/历史语料项目结合？

| 组合方向 | 可形成的研究/产品 | 优先组合的数据 |
|---|---|---|
| 文学 + 历史人口学 | 小说人物年龄、婚姻、职业、家庭与阶层表征如何随时代/文类变化 | LitBank/BookNLP + 公开人口普查与历史人口统计；注意虚构人物不是现实人口的随机样本 |
| 文学 + 经济史 | 价格、工资、贫困、消费和债务在小说中的叙事频率如何对应历史经济环境 | 公有领域小说 + GPIH + Maddison/GGDC；文本频率是文化表达而不是宏观变量的直接观测 |
| 文学 + 历史 GIS | 从小说/游记/书信提取地名，将地名映射到历史行政区和历史地图 | Gutenberg/历史书信 + CHGIS/TRF-GIS + IIIF/TEI |
| 报刊 + 冲突/政治史 | 识别战争、外交、选举和政策事件，比较不同时地报纸的报道差异 | Chronicling America、Trove、COW；用人工验证报道语气、时间与事件的对应关系 |
| 档案 + 历史网络科学 | 从书信、日记、任职名单与机构文件构建人物/组织动态图 | CBDB、历史书信、档案目录、Wikidata；需为每条关系保留来源与置信度 |
| 古籍 + 历史语言学 | 追踪概念、词义、典故和异体字随世纪变化 | Chinese Text Project、Open Greek Corpus、OpenITI、Google Books Ngram 适用语言子集；聚合 n-gram 不能替代原文上下文 |
| 气候史 + 历史事件抽取 | 将旱灾、寒潮、饥荒和迁徙记载与古气候代理数据对齐 | 历史报纸/档案 + HYDE/Neotoma/PAGES 2k；要记录记述事件的时间与气候代理的年代不确定性 |
| 司法史 + 文学/报刊 | 对比法庭记录、新闻描述、小说叙事中的犯罪与身份概念 | Old Bailey、历史报纸、文学实体/事件标注集；必须区分法庭事实、新闻转述和虚构情节 |

这些组合最有价值的不是“用 LLM 汇总更多文本”，而是把不同类型的证据连起来：原始文字提供当时的人如何叙述，结构化统计提供独立的量化信号，地图与边界解释空间差异，学术研究和专家判断校验解释。在数据模型中应保留证据类型与来源，不要把小说叙事、报刊报道、人口统计和模型推断合并成一个无差别的“历史事实”。

## 14. 参考资料与主要入口

### 文学与长文档语言模型

- [Project Gutenberg 许可证](https://www.gutenberg.org/policy/license)
- [PG-19：Google DeepMind 说明](https://deepmind.google/blog/a-new-model-and-dataset-for-long-range-memory/)
- [PG-19 代码与基准](https://github.com/google-deepmind/pg19)
- [LitBank 数据集与论文列表](https://github.com/dbamman/litbank)
- [BookNLP](https://github.com/booknlp/booknlp)
- [HTRC BookNLP/ELF](https://htrc.atlassian.net/wiki/spaces/COM/pages/43300179/HTRC%2BBookNLP%2BDataset%2Bfor%2BEnglish-Language%2BFiction)
- [HTRC Extracted Features 2.0](https://htrc.atlassian.net/wiki/spaces/COM/pages/43295914/Extracted%2BFeatures%2Bv.2.0/)
- [Google Books Ngram](https://books.google.com/ngrams/info)
- [Common Pile v0.1（NeurIPS 2025）](https://proceedings.neurips.cc/paper_files/paper/2025/hash/52acc050138d6f40dad6f12f91a4ce22-Abstract-Datasets_and_Benchmarks_Track.html)
- [The Pile 论文](https://arxiv.org/abs/2101.00027)
- [Stylometry with R / stylo 论文](https://doi.org/10.32614/RJ-2016-007)

### 历史报纸与档案

- [Chronicling America 主集合](https://www.loc.gov/collections/chronicling-america/)
- [Chronicling America API](https://www.loc.gov/apis/additional-apis/chronicling-america-api/)
- [批量数据和 OCR 下载](https://www.loc.gov/collections/chronicling-america/datasets/)
- [Chronicling America rights and access](https://www.loc.gov/collections/chronicling-america/about-this-collection/rights-and-access/)
- [Living with Machines](https://www.turing.ac.uk/research/research-projects/living-machines)
- [LwMDB 数据](https://research.lancaster-university.uk/en/datasets/lwmdb-data/)
- [Old Bailey Proceedings Online](https://www.oldbaileyonline.org/)
- [IMPACT 历史文档数据集档案](https://digitisation.eu/datasets/)
- [Transkribus Datasets](https://www.transkribus.org/datasets)
- [Transkribus pricing](https://www.transkribus.org/pricing)

### 中日韩与古典语言

- [Chinese Text Project API 与数字人文工具](https://ctext.org/digital-humanities)
- [CBDB 项目主页](https://cbdb.hsites.harvard.edu/)
- [CBDB 数据许可条款（2026-08-20 起）](https://cbdb.hsites.harvard.edu/cbdb-data-licensing-terms)
- [CODH 开放人文学科数据集](https://codh.rois.ac.jp/dataset/index.html.en)
- [KMNIST 说明](https://codh.rois.ac.jp/kmnist/index.html.en)
- [Perseus Digital Library](https://www.perseus.tufts.edu/)
- [Open Greek Corpus](https://opengreek.org/)
- [CLTK](https://github.com/cltk/cltk)
- [OpenITI Corpus](https://openiti.org/projects/OpenITI%20Corpus.html)

### 标准和工程

- [TEI Guidelines](https://tei-c.org/guidelines/)
- [IIIF](https://iiif.io/)
- [ALTO XML](https://www.loc.gov/standards/alto/)
- [PAGE XML](https://github.com/PRImA-Research-Lab/PAGE-XML)
- [METS](https://www.loc.gov/standards/mets/)
- [MODS](https://www.loc.gov/standards/mods/)
- [PREMIS](https://www.loc.gov/standards/premis/)
- [EAD](https://www.loc.gov/ead/)
- [Universal Dependencies / CoNLL-U](https://universaldependencies.org/format.html)

## 结论

文学和历史数据不是简单的长文本集合，而是由作品、版本、馆藏、图像、转录、校订、人物、地点、时间和版权关系共同组成的证据系统。Project Gutenberg、PG-19、LitBank、Google Books Ngram、Chronicling America、HathiTrust 衍生数据、Open Greek Corpus、OpenITI、CBDB 和日本古籍数据，分别解决了不同问题，不能相互替代。EEBO、ECCO、LION、COHA 和大型数字图书馆则提醒我们：高质量全文、长历史跨度与可靠元数据经常需要机构订阅或研究授权，而不只是下载一个开放源码工具。

非 LLM 工具在 OCR/HTR、文体学、实体提取、角色共指、主题分析和元数据链接方面仍然非常重要；LLM 适合在有来源、有版本、有引用证据的基础上做语义检索、问答、辅助标注和受许可语料的训练。可靠的长期项目应该保留原始材料、学术转录、规范化文本和自动输出的区别，使用 TEI/IIIF/ALTO/PAGE 等适合人文数据的格式，按照作品/版本/时间隔离测试集，并建立可审计的许可清单、数据血缘与模型评估流程。

*免责声明：本文是截至 2026 年 10 月 24 日的技术与数据资源综述，不构成版权法律意见。商业用途、模型训练、全文缓存、embedding 共享、模型权重发布和对外检索服务均须依适用司法辖区及具体数据条款核查。*