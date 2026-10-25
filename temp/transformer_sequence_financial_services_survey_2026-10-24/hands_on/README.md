# PaySim 交易序列模型：手把手实验

使用模拟金融交易数据 PaySim，从数据准备开始，训练逻辑回归基线和小型 GRU（门控循环单元）序列分类器，并按时间切分评估。此项目用于学习实验方法，不是生产反欺诈系统。

## 数据集

下载 [Kaggle: Synthetic Financial Datasets For Fraud Detection (PaySim)](https://www.kaggle.com/datasets/ealaxi/paysim1)，接受数据集条款后解压，把 `PS_20174392719_1491204439457_log.csv` 放入 `data/raw/`。也可使用已配置的 Kaggle API：`kaggle datasets download -d ealaxi/paysim1 -p data/raw --unzip`。不要把 API token 或数据文件提交到 Git。

PaySim 是模拟的移动支付数据，不是真实银行交易。实验结果不能直接外推到真实银行卡欺诈或 AML 场景。

## 在 MacBook 上运行

MacBook Air M5 16 GB 足以运行这个小型 GRU 实验。先从 CPU 开始，确认数据与评估流程正确；若本机 PyTorch 支持 Apple Silicon MPS，再试 `--device mps`。无需为了这个模型租 GPU。

```bash
cd temp/transformer_sequence_financial_services_survey_2026-10-24/hands_on
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
mkdir -p data/raw
# 将下载的 CSV 放入 data/raw/
python train.py --data data/raw/PS_20174392719_1491204439457_log.csv --model baseline
python train.py --data data/raw/PS_20174392719_1491204439457_log.csv --model gru --epochs 3
```

第一次可用 `--epochs 1` 验证全流程。脚本按时间先后划分训练、验证和测试集；标准化参数只在训练集拟合。每个账户的序列只在各自时间切分内部构造，属于保守的入门设置。脚本不会把标签 `isFraud` 或模拟规则字段 `isFlaggedFraud` 当作输入特征。

## 指标如何解释

- PR-AUC：欺诈样本很少时，比准确率更有参考价值。
- ROC-AUC：衡量排序能力，但在类别极不平衡时可能显得乐观。
- Recall@1% review budget：假设只能人工审核风险最高的 1% 交易，这些交易覆盖了多少欺诈样本。
- 逻辑回归只是简单基线。严谨实验还应增加 LightGBM/CatBoost、多个时间窗口和随机种子，并做消融。

## 什么时候用 Colab 或 Kaggle？

| 环境 | 适用场景 |
|---|---|
| MacBook | 数据检查、特征工程、小型 GRU、错误分析；建议先用它 |
| [Google Colab](https://colab.research.google.com/) | 需要 GPU 或跑更多参数组合；上传 CSV 和 `train.py`，选择 GPU 运行时 |
| [Kaggle Notebooks](https://www.kaggle.com/code) | 数据集直接挂载，便于公开数据实验；Notebook 中添加 PaySim 数据集 |

云端运行时可能重置，训练产物需另存到 Google Drive 或下载。GPU 不会自动提高模型质量；如果扩大到更长序列、更大 Transformer 或多个随机种子，再考虑云端。

后续可研究：GRU 对比小型 Transformer/TCN；历史窗口长度 5/10/20/50；当前交易特征与序列特征消融；标签延迟、时间漂移、推理延迟。任何在线学习实验都应先做离线按时间评估，并记录模型版本、标签成熟时间和回滚策略。


---

## Transformer 入门实验（推荐先完成）

如果没有深度学习经验，先从小型可运行样例入手，再进入 PaySim 的交易分类项目。

### 1. 手写 Attention

运行缩放点积注意力、多头注意力和因果掩码的最小实现：

~~~bash
python attention_from_scratch.py
~~~

观察张量形状、Attention Weights 的行和，以及打开因果掩码后早期位置不能查看未来位置的断言。

### 2. 训练一个小型 Transformer

该实验不需要外部数据，程序会生成可重复的合成时间序列，预测未来 5 个时间点的累计收益：

~~~bash
python toy_transformer.py --epochs 8
~~~

程序会打印数据形状与时间切分，训练 Transformer，并将零预测和 Ridge 基线与 Transformer 放在同一测试区间比较。输出写入 outputs/toy_transformer/。

**注意：这是用于理解张量、训练循环和时间切分的合成数据练习，不代表真实市场存在可交易的预测信号。**

### 3. 再运行公开金融数据实验

- ETF 多资产收益预测：[investment_research/README.md](investment_research/README.md)，对应代码为 transformer_research.py。
- 国债收益率曲线预测：pricing_curve_transformer.py，使用公开 FRED 数据。
- PaySim 欺诈分类：本 README 前半部分的 train.py，提供逻辑回归和 GRU 基线，可用于进一步比较 Transformer Encoder。

进入真实数据实验时，先检查数据源、时间点、目标对齐与基线。合成实验、公开数据离线实验和生产业务收益是不同级别的证据。
