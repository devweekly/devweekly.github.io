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
