import duckdb

def main():
    con = duckdb.connect(database=':memory:')
    with open('lookthrough_demo.sql', 'r', encoding='utf-8') as f:
        sql_script = f.read()
    
    statements = [s.strip() for s in sql_script.split(';') if s.strip()]
    for stmt in statements[:-1]:
        con.execute(stmt)
    
    result_df = con.execute(statements[-1]).df()
    print("=== Look-Through 穿透聚合结果 ===")
    print(result_df.to_string(index=False))
    print(f"\n总穿透权重合计: {result_df['effective_weight_pct'].sum():.4f}%")

if __name__ == '__main__':
    main()
