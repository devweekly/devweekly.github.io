-- Run after deploy_semantic_view.py --deploy.
-- 1. Object discovery and metadata.
SHOW SEMANTIC VIEWS IN SCHEMA SV_FINANCE_LAB.MART;
DESCRIBE SEMANTIC VIEW SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW;

-- 2. Metric regression for the teaching fixture. Expected:
-- Core Fixed Income: MV=11660.00, cost=11200.00, unrealized P&L=460.00
-- US Equity Growth: MV=12450.00, cost=11300.00, unrealized P&L=1150.00
SELECT PORTFOLIO_NAME,
       AS_OF_DATE,
       AGG(TOTAL_MARKET_VALUE_USD) AS MARKET_VALUE_USD,
       AGG(TOTAL_COST_BASIS_USD) AS COST_BASIS_USD,
       AGG(TOTAL_UNREALIZED_PNL_USD) AS UNREALIZED_PNL_USD,
       AGG(POSITION_COUNT) AS POSITION_COUNT
FROM SV_FINANCE_LAB.MART.INVESTMENT_PORTFOLIO_OVERVIEW
WHERE AS_OF_DATE = '2026-10-27'
GROUP BY PORTFOLIO_NAME, AS_OF_DATE
ORDER BY PORTFOLIO_NAME;

-- 3. Independent reconciliation using the physical tables, without the semantic definition.
SELECT p.PORTFOLIO_NAME,
       f.AS_OF_DATE,
       SUM(f.MARKET_VALUE_USD) AS MARKET_VALUE_USD,
       SUM(f.COST_BASIS_USD) AS COST_BASIS_USD,
       SUM(f.UNREALIZED_PNL_USD) AS UNREALIZED_PNL_USD,
       COUNT(*) AS POSITION_COUNT
FROM SV_FINANCE_LAB.MART.FACT_POSITION_DAILY f
JOIN SV_FINANCE_LAB.MART.DIM_PORTFOLIO p ON p.PORTFOLIO_ID = f.PORTFOLIO_ID
WHERE f.AS_OF_DATE = '2026-10-27'
GROUP BY p.PORTFOLIO_NAME, f.AS_OF_DATE
ORDER BY p.PORTFOLIO_NAME;

-- 4. A useful diagnostic: semantic totals over multiple dates are not a monthly AUM measure.
-- Use a single as-of date for point-in-time totals, unless an explicitly defined
-- time-average/period-end metric is implemented.
