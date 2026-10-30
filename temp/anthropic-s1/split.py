#!/usr/bin/env python3
"""把 anthropic-s1.en.md 按章节切到 zh/_src/。

切分按字符数控制（默认 6 万），在段落边界处断开，
让每个译制单元都能在单次输出里译完。
"""
import os
import re

TARGET = 60_000

# (起始行, 结束行, 单元名)；行号对应 anthropic-s1.en.md
SECTIONS = [
    (150, 236, 'defined-terms'),
    (236, 365, 'prospectus-summary'),
    (365, 581, 'governance-summary'),
    (581, 1684, 'risk-factors'),
    (1684, 1755, 'forward-and-market'),
    (1755, 1855, 'capitalization'),
    (1855, 2968, 'mdna'),
    (2968, 3729, 'business'),
    (3729, 3882, 'governance'),
    (3882, 4085, 'management'),
    (4085, 4455, 'exec-compensation'),
    (4455, 4614, 'related-party'),
    (4614, 4693, 'principal-stockholders'),
    (4693, 4925, 'capital-stock'),
    (4925, 5077, 'shares-eligible'),
    (5077, 5389, 'underwriting'),
    (5411, 7237, 'financials'),
]


def main(src='anthropic-s1.en.md', outdir='zh/_src'):
    lines = open(src, encoding='utf-8').read().split('\n')
    os.makedirs(outdir, exist_ok=True)
    total = 0
    for start, end, slug in SECTIONS:
        body = '\n'.join(lines[start - 1:end - 1]).replace('](images/', '](../images/')
        paras = re.split(r'\n\s*\n', body)
        chunks, cur, size = [], [], 0
        for p in paras:
            if cur and size + len(p) > TARGET:
                chunks.append('\n\n'.join(cur))
                cur, size = [], 0
            cur.append(p)
            size += len(p) + 2
        if cur:
            chunks.append('\n\n'.join(cur))
        for i, c in enumerate(chunks, 1):
            name = slug if len(chunks) == 1 else f'{slug}-{i}'
            open(f'{outdir}/{name}.md', 'w', encoding='utf-8').write(c.strip() + '\n')
            total += len(c)
            print(f'{name:32}{len(c):9,d}')
    print(f'{"合计":32}{total:9,d}')


if __name__ == '__main__':
    main()
