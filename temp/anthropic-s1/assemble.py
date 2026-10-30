#!/usr/bin/env python3
"""把 zh/ 下分章译文合并成单文件 anthropic-s1.zh.md。"""
import re

ORDER = [
    ('00-front-matter', '封面与登记声明'),
    ('defined-terms', '若干定义术语'),
    ('prospectus-summary', '招股说明书摘要'),
    ('governance-summary', '本公司的治理结构及其目标（摘要部分）'),
    ('risk-factors-1', '风险因素（一）'),
    ('risk-factors-2', '风险因素（二）'),
    ('risk-factors-3', '风险因素（三）'),
    ('risk-factors-4', '风险因素（四）'),
    ('risk-factors-5', '风险因素（五）'),
    ('forward-and-market', '前瞻性陈述、行业与市场数据'),
    ('capitalization', '募集资金用途、股利政策、资本化与摊薄'),
    ('mdna-1', '管理层对财务状况与经营成果的讨论与分析（一）'),
    ('mdna-2', '管理层对财务状况与经营成果的讨论与分析（二）'),
    ('mdna-3', '管理层对财务状况与经营成果的讨论与分析（三）'),
    ('business-1', '业务（一）'),
    ('business-2', '业务（二）'),
    ('business-3', '业务（三）'),
    ('business-4', '业务（四）'),
    ('governance', '本公司的治理结构及其目标'),
    ('management', '管理层'),
    ('exec-compensation-1', '高管薪酬（一）'),
    ('exec-compensation-2', '高管薪酬（二）'),
    ('related-party', '关联方交易'),
    ('principal-stockholders', '主要股东与售股股东'),
    ('capital-stock-1', '股本说明（一）'),
    ('capital-stock-2', '股本说明（二）'),
    ('shares-eligible', '未来可出售股份'),
    ('tax', '对美国境外持有人的重大美国联邦所得税后果'),
    ('underwriting-1', '承销（一）'),
    ('underwriting-2', '承销（二）'),
    ('financials-1', '合并财务报表及其附注（一）'),
    ('financials-2', '合并财务报表及其附注（二）'),
    ('financials-3', '合并财务报表及其附注（三）'),
    ('financials-4', '合并财务报表及其附注（四）'),
    ('18-back-matter', '法律事项与专家'),
    ('19-part-ii', 'Part II：招股说明书之外的信息'),
]


def main():
    units = []
    for name, title in ORDER:
        t = open(f'zh/{name}.md', encoding='utf-8').read().strip()
        t = re.sub(r'\A#{1,3}\s+.*\n', '', t).strip()   # 去掉文件自带标题，用统一章名
        open(f'zh/{name}.md', 'w', encoding='utf-8').write(f'# {title}\n\n' + t + '\n')
        units.append([name, title, t])

    doc = ['# Anthropic, PBC 招股说明书（Form S-1）中文全译', '',
           '> 原文：SEC EDGAR accession 0001628280-26-067168，2026-10-26 提交（`anthropicpbc-sx1.htm`）。',
           '> 全文逐段翻译，含封面、登记声明、Part II 与展品清单；原文留白处标注“（原文留白）”。',
           '> 体例见 `zh/_STYLE.md`。', '', '## 目录', '']
    doc += [f'- {u[1]}' for u in units]
    doc += ['', '---', '']

    for _, title, body in units:
        content = re.sub(r'^(#+)', r'#\1', body, flags=re.M)   # 内部标题降一级
        content = content.replace('](../images/', '](images/')  # 合并稿与 images/ 同级
        doc += [f'## {title}', content.strip(), '']

    out = '\n'.join(doc)
    open('anthropic-s1.zh.md', 'w', encoding='utf-8').write(out)
    han = len(re.findall(r'[\u4e00-\u9fff]', out))
    print(f'章节 {len(units)} | 字符 {len(out):,} | 汉字 {han:,} | 行 {out.count(chr(10)) + 1:,}')


if __name__ == '__main__':
    main()
