# 投资研究手把手项目：ETF 多资产趋势与风险分析

这个项目把前一示例的“交易欺诈分类”换成投资研究业务：使用公开市场价格，构建一个可复现的多资产研究流程，比较简单基线与 GRU 序列模型，输出预测评估、风险统计和一个明确标注为研究用途的示例组合回测。

**研究问题：** 截至每个交易日收盘时，过去约 60 个交易日的收益、波动、趋势和跨资产信息，能否帮助预测各 ETF 未来 5 个交易日的收益排序？这种排序是否比简单的历史动量基线更有用？

这不是投资建议，也不是声称 GRU 能稳定战胜市场。金融收益噪声很大；研究的主要目标是建立正确的 point-in-time 数据流程、时间外评估、基线对照和交易成本敏感性分析。

## 1. 数据与范围

使用 Yahoo Finance 可下载的公开历史行情，通过开源 Python 包 `yfinance` 获取日线。代码默认使用一组流动性较高的美国 ETF 作为教学样本：

- `SPY`：美国大盘股票市场代理
- `QQQ`：纳斯达克 100 股票代理
- `IWM`：美国小盘股票代理
- `EFA`：发达市场（美国以外）股票代理
- `TLT`：长期美国国债代理
- `GLD`：黄金代理
- `SHY`：短期美国国债代理

来源与限制：
- [yfinance 文档](https://ranaroussi.github.io/yfinance/)说明它是面向研究和教育用途的开源接口，不隶属于 Yahoo；使用数据时仍需遵守 Yahoo 的条款。
- 这不是完整的机构级、点时（point-in-time）证券主数据，也没有系统性处理退市股票、生存者偏差、公司行为细节、交易限制或真实成交价差。
- ETF 选择是固定的教学样本，不能代表历史上当时可投资的完整资产集合。

## 2. 研究目录

```text
investment_research/
  README.md
  requirements.txt
  research.py
  outputs/                 # 运行时生成，不提交 Git
```

## 3. 在 MacBook 上逐步运行

MacBook Air M5 16 GB 足以运行这个小规模实验，默认 CPU 即可，不需要 GPU。

```bash
cd temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on/investment_research
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python research.py --start 2012-01-01 --end 2026-01-01 --epochs 10
```

注意：`--end` 按 yfinance 的惯例作为排他日期；若要纳入某个日期，结束日期应设为下一天。首次运行需要网络访问行情源。若行情下载失败，先单独重试下载，不要把空数据误认为模型结果。

## 4. 代码逐步说明

### Step 1：下载与整理价格

脚本下载 ETF 日线，使用调整后的 OHLC 数据（`auto_adjust=True`），并以调整后收盘价计算收益。先统一交易日期索引，再检查缺失值。不同资产假日安排不完全一致，合并后仅在计算特征前对价格做有限的前向填充；不会使用未来价格反向填充。

### Step 2：构造只依赖过去数据的特征

对每个资产计算：
- 日收益率；
- 5 日与 20 日累计收益；
- 20 日历史波动率；
- 60 日趋势（价格相对 60 日均线）；
- 其他 ETF 当日收益，作为跨资产市场状态信息。

特征在日期 (t) 收盘后可计算。标签是从 (t) 收盘到 (t+5) 收盘的未来收益。特征与标签时间区间不应混淆：训练模型可以使用历史标签，但模拟 (t) 日决策时不能读到 (t+5) 的价格。

### Step 3：严格按时间划分

训练、验证、测试按日期先后切分，不随机打乱。模型标准化器只在训练集拟合。GRU 的训练样本仅取目标日位于训练区间的窗口；验证和测试样本只用于各自阶段。因为标签跨越未来 5 个交易日，代码在训练与验证边界留出隔离区，降低标签窗口跨越边界造成的污染。

### Step 4：先比较基线，再比较 GRU

- **零预测基线**：预测未来收益为 0，帮助判断预测误差是否真的优于无信息预测。
- **动量基线**：用过去 20 日收益作为未来 5 日收益的预测值。它非常简单，但可作为有经济直觉的参考。
- **Ridge 回归**：在同一套历史特征上做线性预测。
- **GRU**：按时间顺序读取最近 60 个交易日的特征，输出未来 5 日收益预测。

所有模型使用相同的测试日期与资产。GRU 并不天然优于 Ridge 或动量；如果复杂模型没有在时间外数据上增加价值，应优先保留更简单、更易解释的方案。

### Step 5：用研究指标而不只看一个分数

脚本输出：
- MAE、方向命中率和每日横截面 Spearman 排名相关；
- 预测结果 CSV；
- 基于预测排名的简单多资产示例策略；
- 等权 ETF 组合与 SPY 买入持有基准；
- 年化收益、年化波动率、Sharpe、最大回撤和换手率等统计。

策略在每个调仓日根据模型预测选择排名最高的两个 ETF，下一交易日开始持有，并收取可配置的单边交易成本。回测使用简单的收盘到收盘收益近似，不能代替真实成交模拟；指标样本短、资产少、策略参数固定，都可能造成结果不稳定。请重点检查扣除成本前后、不同时间区间和不同模型之间的差异。

### Step 6：查看产物与复现实验

`outputs/` 下会写入数据快照、模型比较指标、逐资产预测、策略净值序列与摘要。运行时自动记录日期范围、资产列表和关键参数。不同日期下载的数据可能因供应商修订而略有差异；严肃研究应保存数据快照和环境版本。

## 5. Colab / Kaggle 怎么运行？

如果本机安装 PyTorch 或行情源访问遇到问题，可在 [Google Colab](https://colab.research.google.com/) 或 [Kaggle Notebooks](https://www.kaggle.com/code) 运行相同脚本。创建 Python Notebook 后上传本目录的 `research.py` 与 `requirements.txt`，执行：

```python
!pip install -r requirements.txt
!python research.py --start 2012-01-01 --end 2026-01-01 --epochs 10
```

这份小型 GRU 不依赖 GPU；云端的主要价值是可复现环境，而不是必然提高准确率。行情源可能在云端受到网络或速率限制。

## 6. 如何把教学示例升级成投资研究平台 PoC

建议按以下顺序扩展，而不是先扩大模型：

1. **数据治理：** 引入可审计的行情快照、交易日历、证券主数据、公司行为和数据版本。
2. **研究基线：** 增加季节性/动量、线性模型、LightGBM，以及简单风险模型。
3. **Point-in-time：** 使用当时可获得的财报与宏观数据，按实际发布时间而非报告期回填；避免未来修订数据泄漏。
4. **组合构建：** 将预测转换为带风险约束的权重，加入行业/资产集中度、波动率目标、最大回撤约束与现金基准。
5. **成本与可交易性：** 估算 bid-ask spread、佣金、冲击成本、借券成本和市场容量；检查成交延迟与调仓频率。
6. **验证：** 做 walk-forward 多窗口回测、子时期分析、参数敏感性、模型消融和预测校准；报告不确定性，不只挑最好的一段。
7. **研究工作台：** 把数据质量、因子暴露、预测、回测、风险归因和研究结论保存为可追溯的研究 run，供分析师审阅，而不是把一个预测值直接当交易指令。

## 7. 参考资料

- [yfinance 官方文档](https://ranaroussi.github.io/yfinance/)
- [Yahoo Finance 数据服务条款入口](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html)
- [scikit-learn TimeSeriesSplit 文档](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)
- [PyTorch GRU 文档](https://pytorch.org/docs/stable/generated/torch.nn.GRU.html)

**解释边界：** 这个项目证明的是可以搭建一条从公开行情到时间外评估的研究流水线，不证明可盈利、可执行或适合真实资金。任何实盘用途都需要独立的数据、合规、模型风险、交易成本和投资委员会审查。


## 8. Transformer 版本：与 GRU 使用同一份数据和评估流程

如果想比较注意力模型而不是循环神经网络，项目另外提供 `transformer_research.py`。它复用相同的数据源、资产集合、特征、预测期限、时间切分、Ridge / 动量基线和回测逻辑，主要替换序列编码器，便于做相对公平的模型比较。

### Step 1：安装依赖

如果已经按前面步骤创建并启用了虚拟环境，不需要重复创建；否则先完成前面的安装步骤。

### Step 2：运行 Transformer

```bash
python transformer_research.py \
  --start 2012-01-01 \
  --end 2026-01-01 \
  --epochs 10 \
  --batch-size 256
```

先跑 1–3 个 epoch 确认环境和数据下载正常，再根据验证集 MAE 和运行时间决定是否增加训练轮数。默认设备自动选择 CUDA、Apple Silicon MPS 或 CPU；这个小模型通常无需 GPU。

### Step 3：理解模型结构

模型把每一天的 8 个数值特征投影到 32 维向量，加入可学习的位置嵌入，然后送入 2 层 Transformer Encoder。每层使用 4 个 attention heads，模型读取 60 个交易日的窗口，取最后一个时间位置的表示，通过小型回归头预测未来 5 个交易日收益。

位置嵌入很重要：注意力机制本身不会自动知道序列里哪个观测更早、哪个更晚。位置向量让模型能区分窗口中的时间位置。此处使用 encoder-only 架构，因为目标是把已知历史编码成一个预测值，不需要 decoder 生成未来价格序列。

### Step 4：检查输出

输出仍然写入 `outputs/`，文件名与 GRU 版本相同，但预测列及回测文件会使用 `transformer_pred` 标识。**不要把两个脚本依次写入同一目录后误以为它们是同一轮实验。** 建议使用不同目录保存结果：

```bash
python research.py --output-dir outputs/gru --epochs 10
python transformer_research.py --output-dir outputs/transformer --epochs 10
```

### Step 5：公平比较 GRU 与 Transformer

至少保持相同的日期范围、资产列表、特征、60 日窗口、5 日目标、训练/验证/测试边界、随机种子和交易成本。对比：

- Transformer 是否在测试集的 MAE / RMSE 上优于 Ridge、动量和 GRU；
- 每日横截面 rank IC 是否更稳定，而不是只在少数日期表现突出；
- 策略扣除成本后的收益、最大回撤与换手是否改善；
- 结果是否对起止日期、不同市场阶段、随机种子和成本假设敏感；
- 额外的训练时间与模型复杂度是否值得任何性能增益。

当前代码是教学版的单次时间切分，不是足以证明投资优势的统计验证。若 Transformer 只略微改善预测误差，却让回测换手或回撤变差，就不能据此断言它更适合投资业务。应增加多次 walk-forward 测试、置信区间、更多资产和更强基线。

Transformer 依赖 PyTorch 的 `TransformerEncoderLayer` 和 `TransformerEncoder`；其输入采用 `batch_first=True`，张量形状为 batch × sequence × feature。参考 [PyTorch TransformerEncoderLayer 文档](https://docs.pytorch.org/docs/stable/generated/torch.nn.TransformerEncoderLayer.html)。


## 9. Gradient Boosting Tree 版本：先尝试强表格模型

除了 GRU 和 Transformer，本项目增加 scikit-learn 的 `HistGradientBoostingRegressor`。它属于梯度提升决策树（GBDT）家族，能学习非线性关系和特征交互；它把每个资产、每个决策日的特征行作为一个样本，不要求 60 天窗口，也不需要 GPU。对于几只 ETF、日频数据和有限样本的研究任务，它是值得优先比较的模型。参考：[官方模型文档](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.HistGradientBoostingRegressor.html) 和[时间序列滞后特征示例](https://scikit-learn.org/stable/auto_examples/applications/plot_time_series_lagged_features.html)。

### Step 1：运行脚本

在项目目录启用已有虚拟环境后运行：

```bash
python tree_research.py --start 2012-01-01 --end 2026-01-01 --cost-bps 5 --output-dir outputs/tree
```

依赖已在 `requirements.txt` 中，不需要另装 LightGBM 或 XGBoost。首次运行需要联网下载行情。脚本会打印验证集指标，并将测试集指标、预测、回测曲线和摘要写入 `outputs/tree/`。

### Step 2：模型在做什么

`build_panel()` 将价格变成 8 个结构化特征：1 日、5 日、20 日收益，20 日波动率，60 日趋势，以及市场和跨资产收益统计。GBDT 根据这些特征学习非线性关系，例如趋势强但近期波动也高，与趋势强且波动温和，可能对应不同预测。它不显式读取 60 天逐日序列，因此不能直接学习任意事件顺序；优势是训练快、适合表格特征，且不需要标准化。

### Step 3：时间切分与验证

脚本按日期将样本切为连续的训练、验证和测试区间，并在训练/验证边界前留出未来 5 日标签隔离区。测试集只用于最终评估。缺失值由训练流水线中的中位数填补器处理。模型自身使用 early stopping；如果要系统调参，只能在训练/验证阶段进行，不能根据测试集反复挑参数。

### Step 4：检查结果

`forecast_metrics.csv` 比较零收益、20 日动量与 GBDT 的 MAE、RMSE、方向命中率和每日横截面 rank IC。`backtest_hist_gbr_pred.csv` 是按预测排名构建的教学组合回测。不要只看哪一个模型的年化收益最高；还要检查预测误差、rank IC、换手、最大回撤、成本敏感性，以及结果是否在不同市场子时期稳定。

### Step 5：与 GRU / Transformer 公平比较

```bash
python research.py --output-dir outputs/gru --epochs 10
python transformer_research.py --output-dir outputs/transformer --epochs 10
python tree_research.py --output-dir outputs/tree
```

三种模型的输入方式不同：GRU / Transformer 使用最近 60 日的特征序列，GBDT 使用决策日的结构化特征行。因此这组实验比较的是完整建模方案，而不是仅替换网络层的严格消融。若要隔离序列历史的增量价值，下一步应给 GBDT 增加 1、5、20、60 日滞后特征，并保持相同的时间切分与特征可见性。

对当前规模，建议先建立动量 → Ridge → GBDT → GRU / Transformer 的递进基线。若 GBDT 已达到相近的时间外效果，神经网络必须证明其额外复杂度带来稳定的增量价值，而不是仅在某一次回测中碰巧收益更高。

**边界：** 本脚本尚未实际下载行情或训练模型验证运行结果；首次运行需要联网。示例数据、单次时间切分与简化回测均不足以证明策略可盈利，正式研究应加入 walk-forward 多窗口验证、交易成本敏感性和 point-in-time 数据治理。


## 10. 用例一：Transformer 预测未来波动率（投资组合风险管理）

收益预测回答“可能涨跌多少”，波动率预测回答“未来风险可能有多大”。风险团队或投资组合经理可以将未来 5 个交易日的波动率预测作为风险监控输入，辅助调整风险预算、仓位上限或压力测试频率；它不应该被直接解释为买卖信号。

### Step 1：运行

```bash
python volatility_transformer.py \
  --start 2012-01-01 \
  --end 2026-01-01 \
  --epochs 12 \
  --output-dir outputs/volatility
```

### Step 2：理解标签与特征

每个 ETF 使用过去 60 个交易日的收益、短中期波动、趋势和跨资产状态作为输入。标签是从当前决策日之后 5 个交易日收益计算的年化实现波动率。训练目标不是未来收益方向，因此模型即使准确预测波动率，也不表示能预测涨跌。

### Step 3：训练与评估

脚本使用 Transformer Encoder，按时间先后切分训练、验证、测试集，并在边界前留出 5 日隔离区。标准化器只在训练样本上拟合；验证集用于 early stopping。报告测试集 MAE、RMSE，并与训练期中位数波动率基线比较。

### Step 4：查看结果

- `volatility_predictions.csv`：每个日期和 ETF 的预测波动率、实际波动率及误差。
- `summary.json`：测试误差、基线表现和局限性。

公开日线数据得到的是日频收益的未来实现波动率近似，并非由高频逐笔数据计算的机构级 realized volatility。若用于风险预算，应进一步做滚动窗口回测、压力期单独评估、预测区间校准，以及与 EWMA / GARCH 等基线比较。

## 11. 用例二：Transformer 识别市场状态（战术资产配置研究）

投资研究并不一定要预测某只 ETF 的收益数值。另一类任务是根据历史市场与跨资产表现，判断未来约一个月更接近风险偏好上升、横盘还是风险规避状态。研究团队可以把分类概率交给组合优化或风险政策层，决定是否收紧风险预算；不应让分类结果直接自动交易。

### Step 1：运行

```bash
python regime_transformer.py \
  --start 2012-01-01 \
  --end 2026-01-01 \
  --epochs 12 \
  --output-dir outputs/regime
```

### Step 2：理解三种标签

脚本以 SPY 未来 20 个交易日收益构造教学标签：收益不高于 -3% 为 bear/risk-off，不低于 +3% 为 bull/risk-on，两者之间为 sideways。标签由未来结果定义，训练时模型只读取当前时点及之前的特征。阈值是便于演示的固定规则，不是市场状态的客观真理；改变阈值会改变类别分布和难度。

### Step 3：模型与类别不平衡

输入包含 SPY 的收益、波动率和趋势，以及跨资产波动和 TLT、GLD、QQQ 的收益特征。Transformer 输出三类 logits，再经 softmax 得到类别概率。训练使用按训练集类别频率计算的权重，减轻多数类主导训练的影响。

### Step 4：检查输出

- `regime_predictions.csv`：实际状态、预测状态及各类概率。
- `summary.json`：balanced accuracy、各类 precision/recall/F1 和混淆矩阵。

重点看 bear/risk-off 类的 recall、类别混淆和概率校准，而不只是总体 accuracy。相邻 20 日标签会重叠，且状态阈值是人为定义的，因此应使用 purged walk-forward 验证、不同阈值敏感性分析和基于概率的风险政策评估。类别预测不等于经过验证的资产配置策略。

## 12. 两个新用例如何与收益预测区分

| 用例 | 预测目标 | 主要用户 | 下游决策 |
|---|---|---|---|
| 多资产收益预测（已有） | 未来 5 日收益 | 投资研究 / 量化研究 | 生成候选排序信号，再进入组合构建 |
| 波动率预测 | 未来 5 日实现波动率 | 风险管理 / 组合经理 | 风险预算、限额、压力监控 |
| 市场状态分类 | 未来 20 日的风险偏好状态 | 资产配置 / 宏观策略研究 | 调整风险框架或进入组合优化 |

以上三者应共享 point-in-time 数据原则，但必须分别定义标签、评价指标和业务验收标准。不能因为某模型的分类或波动率误差较好，就推断其投资收益一定更好。


## 13. 用例三：金融机构季度基本面序列研究（SEC XBRL + Transformer）

**业务问题：** 对银行等金融机构的季度财务指标做序列建模，研究净利润下一季度是否改善。这个用例不使用 ETF 行情特征，而是使用 SEC EDGAR 的 Company Facts / XBRL 财报数据；示例覆盖 JPM、BAC、GS、MS、WFC、C。SEC 官方 API 免费提供公司提交记录和结构化 XBRL facts，访问时必须设置有辨识度的 User-Agent。参考 [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)。

### Step 1：安装依赖

在现有虚拟环境中安装：

```bash
pip install requests pandas numpy scikit-learn torch
```

### Step 2：运行下载、构造样本与训练

```bash
python bank_fundamentals_transformer.py \
  --user-agent "Your Name your.email@example.com" \
  --window 8 \
  --epochs 30 \
  --output-dir outputs/bank_fundamentals
```

首次运行需要联网访问 SEC。脚本会下载公司事实、构造收入、净利润、资产、负债、经营现金流及其衍生比率，并将中间数据保存到 `sec_bank_fundamentals.csv`。

### Step 3：理解 Transformer 输入

模型把每家公司最近 8 个财务期间的特征作为一个序列，使用 Transformer Encoder 编码历史，再分类预测下一报告期净利润是否高于当前报告期。它回答的是“财务基本面是否改善”的研究问题，而不是预测股票明天涨跌，也不是估值结论。

### Step 4：评估输出

- `test_predictions.csv`：测试样本日期、实际标签、模型概率和分类结果。
- `summary.json`：测试集 accuracy、balanced accuracy 和分类报告。
- `sec_bank_fundamentals.csv`：下载后整理的结构化样本，方便人工抽查。

金融机构的报表项目并不完全可比，银行、投行和综合金融集团的收入定义可能不同。正式研究必须逐公司检查 XBRL tag 映射、会计口径、异常值与报告期。SEC Company Facts 也可能包含重述值；此教学实现不是完整的 point-in-time 财报数据库，因此不能用于无偏的历史投资回测。还应与“上一季度方向不变”、逻辑回归、XGBoost/GBDT 等基线比较。

## 14. 用例四：金融新闻情绪与事件研究（Financial PhraseBank + FinBERT）

**业务问题：** 研究 Transformer 是否能识别财经句子的正面、负面和中性语气，并将情绪分数作为后续事件研究的候选特征。数据集与上面的 SEC 财务比率完全不同：Financial PhraseBank 是人工标注的财经新闻句子；FinBERT 是在金融语料上训练的预训练 Transformer。

### Step 1：安装依赖

```bash
pip install datasets transformers torch pandas scikit-learn
```

### Step 2：运行

```bash
python financial_news_transformer.py \
  --dataset financial_phrasebank \
  --config sentences_50agree \
  --split train \
  --batch-size 16 \
  --output-dir outputs/financial_news_sentiment
```

首次运行需要从 Hugging Face 下载数据集和 `ProsusAI/finbert` 模型。先用少量样本检查环境：

```bash
python financial_news_transformer.py --max-samples 200 --output-dir outputs/news_smoke
```

### Step 3：理解模型与结果

FinBERT 对每条财经句子输出 negative、neutral、positive 三类概率。脚本保存 `scored_sentences.csv`，并计算一个简单的情绪分数 `positive_probability - negative_probability`；`summary.json` 保存准确率、分类报告和混淆矩阵。

### Step 4：如何把情绪模型变成投资研究

PhraseBank 没有可靠的公司 ID 和事件时间戳，所以它适合验证财经语境下的情绪识别，不足以直接回测股票收益。若要研究财报公告或新闻事件，需要另行取得带发布时间、公司标识符的授权新闻数据，将文本分数按事件窗口聚合，再与严格 point-in-time 的股价、基准收益和行业暴露连接；使用公告之后才可见的信息会产生前视偏差。

两个新用例的数据、任务与模型路径有明确区别：SEC XBRL 是多家公司结构化季度财务指标的序列分类；Financial PhraseBank 是自然语言句子的金融情绪分类。前者侧重基本面序列，后者侧重文本理解。两者都只是研究原型，离投资决策还需要基线比较、时间外验证、数据版本治理和业务验收。


# 五类金融数据域的 Transformer 实战

本节新增五个彼此独立的实验。它们不复用前文 ETF 收益预测面板，而分别使用公开利率曲线、SEC 基金持仓、OpenFIGI 证券主数据、合成基金会计对账数据和 LOBSTER 订单簿数据。公开数据可获取性并不相同：有些能直接下载，有些需注册/许可；基金会计账簿通常属于机构内部数据，故明确使用合成数据演示模型流程。

## 15. Price / Pricing：收益率曲线与债券定价环境预测

**业务问题。** 固收定价与估值团队关心收益率曲线形态、期限利差和短期利率变化。此实验使用 FRED 的美国国债恒定期限收益率序列，预测未来 5 个观测日 10 年期收益率变化。这是定价环境的代理任务，不是直接预测某只债券的 clean price、OAS 或公允价值。

**数据来源。** FRED 公布 DGS3MO、DGS2、DGS5、DGS10、DGS30 等日频序列；示例通过 FRED graph CSV 下载，无需在代码里硬编码 API key。请查看 [FRED API 与数据下载说明](https://fred.stlouisfed.org/docs/api/fred/overview.html)。实际使用仍应检查系列许可、缺失日期和修订情况。

### 运行步骤

```bash
pip install pandas numpy requests scikit-learn torch
python pricing_curve_transformer.py --start 2000-01-01 --end 2026-01-01 --window 60 --epochs 20 --output-dir outputs/pricing_curve
```

代码会下载收益率，构造各期限收益率水平、5 日变化、10 年减 3 个月利差和 30 年减 5 年利差。每个样本使用过去 60 个观测点，经 Transformer Encoder 编码后回归未来 5 个观测日的 10 年期收益率变化。收益率以百分比点表示；报告额外乘 100 转换成基点。

输出为 `predictions.csv` 和 `summary.json`。至少比较零变化基线、线性回归、AR/VAR、期限利差规则和 Transformer；还应做滚动时间外测试、升息/降息周期分段分析，并关注 MAE/RMSE（基点）、方向准确率与预测误差的稳定性。若目标是债券价格、利差或估值，应改用对应的 point-in-time 债券价格、票息、到期日、久期、信用利差和现金流数据，不能把国债收益率变化误称为债券价格预测。

## 16. Holdings：预测基金持仓权重变化

**业务问题。** 研究基金下一报告期会增加、减少还是基本维持某项资产的权重。它可用于持仓变化研究、基金风格漂移监控和资金流/拥挤度研究；不应假定公开披露的持仓等于当时实时持仓。

**数据来源。** SEC [Form N-PORT 数据集](https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets)提供注册基金的结构化持仓申报。官方季度 ZIP 往往数百 MB，包含多个关系表。下载前先读 SEC 提供的 README / 数据字典，理解 filing、fund、holding 和 identifiers 之间的键。也可先用 [GCAP Lab 基于 N-PORT 构造的公开持仓研究数据](https://www.nber.org/papers/w34494)了解字段和研究用途。不要把第三方镜像当作 SEC 官方版本。

### 准备输入 CSV

脚本采用规范化输入，以避免把 SEC 原始表的列名差异偷偷猜错。准备 `nport_holdings_normalized.csv`，至少有以下字段：

| 字段 | 含义 |
|---|---|
| `fund_id` | 稳定的基金/系列标识 |
| `report_date` | 持仓报告期日期 |
| `security_id` | 证券标识；优先使用可跨期稳定的 ID |
| `market_value` | 持仓市值，数值型 |
| `net_assets` | 同一基金报告期净资产，数值型 |

若从 SEC 原始数据集构造该文件，应将持仓表连接到同一 filing 的基金信息表，并确认 `market_value` 与 `net_assets` 采用相同币种与计量单位；保留 filing accession、filed date 和 amendment 标记，正式研究应使用披露可见时间而不是单纯的 report_date。一个可复现的起步样本可选同一批基金、连续 8 个以上报告期，并抽查原始 filing 核对总额。

### 运行步骤

```bash
pip install pandas numpy scikit-learn torch
python holdings_transformer.py --csv nport_holdings_normalized.csv --window 4 --epochs 30 --output-dir outputs/holdings
```

模型按基金与证券分组，使用最近 4 个报告期的权重和权重变化，预测下一报告期权重变化。输出 `predictions.csv` 和 `summary.json`。重点比较“权重不变”基线、上一期变化延续基线和 Transformer 的 MAE；还应评估增持/减持方向准确率、组合换手、披露延迟以及不同基金类型的稳定性。

**关键限制：** N-PORT 持仓是滞后披露，存在修订；未出现的证券可能代表清仓，也可能是数据缺失/键连接错误。当前脚本把每条证券持仓序列独立建模，没有显式把同一基金的所有证券约束到权重和，也没有处理新增/退出证券的完整状态。正式版本应把持仓向量作为横截面一起建模、加入现金和其他资产、验证权重和，并使用按 filing 可见时间的 purged walk-forward 测试。

## 17. Reference Data：证券主数据一致性与错误记录识别

**业务问题。** 在基金、订单、估值和会计系统之间，证券标识符、交易代码、证券类型、市场和币种必须一致。错误映射可能导致持仓错配、价格取错或交易失败。本实验从 OpenFIGI API 取得真实证券主数据，再人工注入错误，训练一个小型 Transformer 判断记录是否被破坏。

**数据来源。** [OpenFIGI API](https://www.openfigi.com/api/documentation)支持把 ticker、ISIN、CUSIP 等第三方标识映射到 FIGI 和证券元数据；未认证请求有速率限制，注册 API key 可提高额度。

### 运行步骤

```bash
pip install requests pandas numpy scikit-learn torch
python reference_data_transformer.py --tickers AAPL,MSFT,JPM,SPY,TLT,GLD,NVDA,XOM,KO,IBM,AMZN,META,BAC,GS,QQQ,IWM --epochs 30 --output-dir outputs/reference_data
```

如果有 OpenFIGI API key，可追加 `--api-key YOUR_KEY`。脚本将原始查询结果写入 `openfigi_reference.csv`，并生成 `summary.json`。为了展示监督式质量检测，代码对部分记录的人为字段添加 `__BAD`，并把这些合成记录标记为异常。

这不是对真实生产错误率的估计。由于异常是人为注入的，评估结果只回答“模型能否学会识别这类注入错误”，不能证明它能发现实际的 stale mapping、证券合并、公司行动或跨供应商冲突。正式数据质量平台应从已确认的历史 incident、供应商差异、人工 steward 决策和规则引擎中建立标签，并按证券/发行人分组隔离训练测试，避免相同证券的重复样本泄漏。对于简单的 ticker/FIGI 映射，规则、约束和直接 API lookup 往往比 Transformer 更合适；Transformer 的潜在价值主要在多字段上下文、描述文本和历史变更序列。

## 18. Fund Accounting：基金会计对账异常检测

**业务问题。** 每日基金会计流程需要对持仓估值、现金、应收应付、费用计提、交易结算和 NAV 做对账。Transformer 可读取连续多个估值日的差异特征，判断某日是否存在需要人工调查的异常。真正的基金会计 ledger、administrator books、NAV break 和调账记录通常受机构保密与供应商许可限制；这里没有把不存在的公开生产账簿说成开放数据集，而是用可复现的合成数据演示。

### 运行步骤

```bash
pip install pandas numpy scikit-learn torch
python fund_accounting_transformer.py --days 6000 --window 10 --epochs 20 --output-dir outputs/fund_accounting
```

脚本会生成合成的现金差异、持仓估值差异、费用/应计差异、NAV 变化、未匹配交易数量和陈旧价格数量，并注入可追踪的异常事件。Transformer 读取最近 10 天特征，输出正常/异常分类。输出包含 `test_predictions.csv` 和 `summary.json`。

### 如何理解结果

这份实验的异常标签由生成器预先注入，所以分数仅验证代码路径和模型是否能学习这些规则，不能作为真实基金会计系统的预期准确率。实际落地时，应从双账簿对账差异、NAV 复核、未匹配交易、corporate action、价格陈旧、费用应计、FX 估值差异和已确认的 break ticket 建立标签；按基金、估值日和异常事件切分，避免同一异常事件同时进入训练集和测试集。评估应侧重异常召回率、每基金每日告警量、误报调查成本、告警提前量和金额重要性，而非总体 accuracy。Transformer 应与容差规则、控制总额、稳健统计和 Isolation Forest 等简单基线比较，不能取代会计控制与人工复核。

## 19. Trade：基于订单簿事件的短期价格变动分类

**业务问题。** 对执行交易与市场微观结构研究，输入订单簿报价、挂单量和事件序列，预测未来若干事件后中间价是上涨、下跌还是基本不变。它与日频 ETF 收益预测不同，时间粒度是订单簿事件。

**数据来源。** [LOBSTER](https://vdc.univie.ac.at/data-access/lobster)基于 NASDAQ TotalView-ITCH 重建订单簿，提供高精度时间戳、订单提交/撤销/成交事件和多档深度数据。它需要注册访问，许可和可下载范围应以 LOBSTER 的当前条款为准，不应默认认为免费公开下载。FINRA TRACE 是另一个固定收益成交数据源，但学术级交易明细有资格/许可限制；见 [FINRA Academic TRACE 说明](https://www.finra.org/sites/default/files/TRACE_Academic_Data_sheet.pdf)。

### 准备输入数据

从合法取得的 LOBSTER order-book 文件中，先将数据转换为 CSV，至少包含：

| 字段 | 含义 |
|---|---|
| `timestamp` | 事件时间，保持文件原始顺序 |
| `bid_price_1` / `ask_price_1` | 最优买卖价 |
| `bid_size_1` / `ask_size_1` | 最优买卖挂单量 |

可选加入第二档及更深档位。价格必须统一为实际价格单位，而不是未经转换的整数 tick；同一交易日、证券和交易场所的数据不能混拼。LOBSTER 的原始 order-book 与 message 文件需要按行对应，先根据数据说明核对字段映射。

### 运行步骤

```bash
pip install pandas numpy scikit-learn torch
python trade_orderbook_transformer.py --csv lobster_book.csv --window 100 --horizon 10 --epochs 20 --output-dir outputs/trade_orderbook
```

模型使用最近 100 个事件的中间价变化、价差、买卖挂单不平衡和最优档挂单量，预测未来 10 个事件后中间价上涨、下跌或持平。输出 `predictions.csv` 和 `summary.json`，包含三类概率、平衡准确率和分类报告。

评估必须按时间切分，并在切分边界隔离未来标签窗口。还需比较“持平/多数类”基线、订单簿不平衡规则和 Logistic Regression；报告每类 precision/recall、混淆矩阵、概率校准与不同波动时期表现。即使方向分类准确，也不代表策略可盈利：真实执行还取决于排队位置、成交概率、手续费、延迟、价差、冲击成本、撤单策略和库存风险。当前脚本是事件分类研究，不是完整交易模拟器。

## 20. 五类数据域的建模目标与验收

| 数据域 | 可用数据 | Transformer 目标 | 关键指标 | 最重要的偏差/限制 |
|---|---|---|---|---|
| Price / Pricing | FRED 国债收益率曲线 | 预测未来 5 个观测日的 10Y yield 变化 | MAE/RMSE（bp）、方向准确率 | 收益率变化不等于具体债券估值 |
| Holdings | SEC N-PORT | 预测下一报告期持仓权重变化 | 权重变化 MAE、增减持方向、换手 | 滞后披露、修订、清仓/新增证券 |
| Reference Data | OpenFIGI 元数据 + 合成错误 | 检测被注入的字段错误 | balanced accuracy、各类 precision/recall | 合成错误不能代表真实生产错误 |
| Fund Accounting | 合成 NAV / ledger break 特征 | 识别连续估值日中的对账异常 | 异常 recall、每日误报量、金额覆盖 | 真实账簿通常不可公开获取 |
| Trade | LOBSTER 订单簿事件 | 预测短期 mid-price 方向 | balanced accuracy、每类 recall、校准 | 许可、交易成本、排队和成交概率 |

这些代码主要用于建立数据到模型的端到端研究骨架。正式研究应增加统一配置、数据版本和 schema 校验、可重复的 walk-forward 评估、强基线、模型/数据漂移监控，以及失败时可审计的结果记录。


## 11. 尚未覆盖的金融业务用例与数据缺口

五类基础实验之外，还有公司债合理价格、期权波动率曲面、基金申赎流量、组合风格漂移、历史证券主数据冲突、NAV break 根因、执行成本、订单成交概率和交易后对账等候选场景。补充文档逐项列出了业务目标、输入与标签、数据重点、Transformer 实现思路、评估指标、数据缺口和建议顺序：

[金融服务五类数据域：尚未覆盖的 Transformer 用例、数据缺口与实现方案](../additional_financial_transformer_use_cases_data_gaps_2026-10-24.md)

优先区分公开数据、受许可数据与内部业务数据。合成数据和市场代理标签只能用于验证流程，不能替代真实生产标签；所有训练均应遵循 point-in-time 数据可见性和时间外验证。
