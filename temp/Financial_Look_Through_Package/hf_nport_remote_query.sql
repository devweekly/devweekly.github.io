-- ============================================================================
-- 接入 Hugging Face 真实 SEC Form N-PORT 基金持仓 Parquet 数据集示例
-- ============================================================================
INSTALL httpfs;
LOAD httpfs;

SELECT * 
FROM read_parquet('hf://datasets/ZipLime/fund-holdings-nport/data/*.parquet')
LIMIT 10;
