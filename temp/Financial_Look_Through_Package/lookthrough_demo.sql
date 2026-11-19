-- ============================================================================
-- DuckDB Look-Through (向下穿透) 完整验证脚本
-- 场景：多资产母基金 -> 嵌套外部ETF/FOF -> 底层股票/债券 -> 发行人归集与ESG计算
-- ============================================================================

CREATE OR REPLACE TABLE fund_holdings (
    parent_id VARCHAR,
    parent_name VARCHAR,
    as_of_date DATE,
    holding_id VARCHAR,
    holding_name VARCHAR,
    asset_type VARCHAR,
    weight DECIMAL(10, 6)
);

INSERT INTO fund_holdings VALUES
    ('FID_MULTI_01', 'Fidelity Global Multi-Asset', '2026-10-31', 'IE00B4L5Y983', 'Global Tech ETF', 'FUND', 0.600000),
    ('FID_MULTI_01', 'Fidelity Global Multi-Asset', '2026-10-31', 'LU0996182563', 'Euro Balanced FOF', 'FUND', 0.300000),
    ('FID_MULTI_01', 'Fidelity Global Multi-Asset', '2026-10-31', 'CASH_USD', 'USD Cash Reserve', 'CASH', 0.100000),
    ('IE00B4L5Y983', 'Global Tech ETF', '2026-09-30', 'US0378331005', 'Apple Inc.', 'EQUITY', 0.500000),
    ('IE00B4L5Y983', 'Global Tech ETF', '2026-09-30', 'US5949181045', 'Microsoft Corp.', 'EQUITY', 0.485000),
    ('LU0996182563', 'Euro Balanced FOF', '2026-09-30', 'IE00B4L5Y983', 'Global Tech ETF', 'FUND', 0.400000),
    ('LU0996182563', 'Euro Balanced FOF', '2026-09-30', 'US0378331005', 'Apple Inc.', 'EQUITY', 0.300000),
    ('LU0996182563', 'Euro Balanced FOF', '2026-09-30', 'US912828YV68', 'US Treasury Bond', 'BOND', 0.300000);

CREATE OR REPLACE TABLE security_master_esg (
    security_id VARCHAR PRIMARY KEY,
    ultimate_parent_name VARCHAR,
    sector VARCHAR,
    esg_rating VARCHAR,
    carbon_intensity DECIMAL(10, 2)
);

INSERT INTO security_master_esg VALUES
    ('US0378331005', 'Apple Inc.', 'Information Technology', 'BBB', 14.20),
    ('US5949181045', 'Microsoft Corporation', 'Information Technology', 'AAA', 29.50),
    ('US912828YV68', 'United States Government', 'Sovereign', 'A', 215.80),
    ('CASH_USD', 'Cash & Equivalents', 'Cash', 'N/A', 0.00),
    ('UNIDENTIFIED_RESIDUAL', 'Unreported Fund Residual', 'Unclassified', 'N/A', 0.00);

CREATE OR REPLACE VIEW normalized_holdings AS
WITH fund_weight_sums AS (
    SELECT parent_id, parent_name, as_of_date, SUM(weight) AS total_reported_weight
    FROM fund_holdings
    GROUP BY parent_id, parent_name, as_of_date
)
SELECT parent_id, parent_name, as_of_date, holding_id, holding_name, asset_type, weight
FROM fund_holdings
UNION ALL
SELECT 
    parent_id,
    parent_name,
    as_of_date,
    'UNIDENTIFIED_RESIDUAL' AS holding_id,
    'Unreported Cash/Derivatives Residual' AS holding_name,
    'CASH' AS asset_type,
    ROUND(1.000000 - total_reported_weight, 6) AS weight
FROM fund_weight_sums
WHERE total_reported_weight < 0.999999;

WITH RECURSIVE lookthrough_tree AS (
    SELECT 
        parent_id AS root_fund_id,
        parent_id AS current_parent_id,
        holding_id,
        holding_name,
        asset_type,
        weight AS effective_weight,
        1 AS depth_level,
        parent_id || ' -> ' || holding_id AS path
    FROM normalized_holdings
    WHERE parent_id = 'FID_MULTI_01'

    UNION ALL

    SELECT 
        lt.root_fund_id,
        nh.parent_id AS current_parent_id,
        nh.holding_id,
        nh.holding_name,
        nh.asset_type,
        CAST(lt.effective_weight * nh.weight AS DECIMAL(10, 6)) AS effective_weight,
        lt.depth_level + 1 AS depth_level,
        lt.path || ' -> ' || nh.holding_id AS path
    FROM lookthrough_tree lt
    JOIN normalized_holdings nh
        ON lt.holding_id = nh.parent_id
    WHERE lt.asset_type = 'FUND'
      AND lt.depth_level < 10
)
SELECT 
    sm.ultimate_parent_name AS ultimate_parent,
    sm.sector AS sector,
    sm.esg_rating AS msci_esg_rating,
    ROUND(SUM(lt.effective_weight) * 100, 4) AS effective_weight_pct,
    ROUND(SUM(lt.effective_weight * sm.carbon_intensity), 2) AS weighted_carbon_intensity,
    COUNT(*) AS path_count
FROM lookthrough_tree lt
LEFT JOIN security_master_esg sm
    ON lt.holding_id = sm.security_id
WHERE lt.asset_type <> 'FUND'
GROUP BY 
    sm.ultimate_parent_name, 
    sm.sector, 
    sm.esg_rating
ORDER BY effective_weight_pct DESC;
