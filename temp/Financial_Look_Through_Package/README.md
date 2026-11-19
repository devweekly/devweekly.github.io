# Financial Look-Through (向下穿透) 架构与工程验证资料包

## 文件清单
1. `Financial_Look_Through_Report.md`: 完整版商业产品选型、Build vs. Buy 混合架构决策（含 Mermaid 架构拓扑图）、Morningstar + LSEG + MSCI 联合数据模型及开源数据集报告。
2. `lookthrough_demo.sql`: 可直接在 DuckDB 中运行的递归穿透（`WITH RECURSIVE`）、残差自动补齐与 ESG 加权计算 SQL 脚本。
3. `hf_nport_remote_query.sql`: 使用 DuckDB `httpfs` 扩展远程查询 Hugging Face 公开基金持仓 Parquet 数据集的 SQL 示例。
4. `run_lookthrough.py`: 一键运行 `lookthrough_demo.sql` 并输出格式化穿透平账报表的 Python 脚本。

## 快速运行
```bash
pip install duckdb pandas
python run_lookthrough.py
```
