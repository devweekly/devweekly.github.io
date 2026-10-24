#!/usr/bin/env python3
"""Minimal Markdown -> DOCX builder tailored for the survey document.

Supported: h1-h4, paragraphs, nested bullets, numbered lists, pipe tables,
fenced code blocks, blockquotes, horizontal rules, inline **bold** / `code` / *italic*.
"""
import re
import sys

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

CJK = "PingFang SC"
LATIN = "Helvetica Neue"
MONO = "Menlo"

INK = RGBColor(0x1A, 0x1A, 0x1A)
H1C = RGBColor(0x0F, 0x2E, 0x4C)
H2C = RGBColor(0x1B, 0x4F, 0x72)
H3C = RGBColor(0x2A, 0x5F, 0x7A)
MUTED = RGBColor(0x5F, 0x6B, 0x76)
ACCENT = RGBColor(0xB4, 0x5F, 0x06)


def set_run_font(run, name=LATIN, size=10.5, bold=None, color=None, italic=None):
    run.font.name = name
    run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:ascii"), name)
    rfonts.set(qn("w:hAnsi"), name)
    rfonts.set(qn("w:eastAsia"), CJK)
    rfonts.set(qn("w:cs"), name)


PPR_AFTER_PBDR = (
    "w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap",
    "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
    "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind",
    "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
    "w:textDirection", "w:textAlignment", "w:textboxTightWrap",
    "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
)
PPR_AFTER_SHD = PPR_AFTER_PBDR[1:]
TCPR_AFTER_SHD = (
    "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign",
    "w:hideMark", "w:headers", "w:cellIns", "w:cellDel", "w:cellMerge", "w:tcPrChange",
)
TBLPR_AFTER_TBLW = (
    "w:jc", "w:tblCellSpacing", "w:tblInd", "w:tblBorders", "w:shd",
    "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption",
    "w:tblDescription", "w:tblPrChange",
)
TBLPR_AFTER_BORDERS = (
    "w:shd", "w:tblLayout", "w:tblCellMar", "w:tblLook", "w:tblCaption",
    "w:tblDescription", "w:tblPrChange",
)
TBLPR_AFTER_LAYOUT = (
    "w:tblCellMar", "w:tblLook", "w:tblCaption", "w:tblDescription", "w:tblPrChange",
)


def shade(element, hex_fill):
    if element.tag.endswith("tc"):
        pr = element.get_or_add_tcPr()
        successors = TCPR_AFTER_SHD
    else:
        pr = element.get_or_add_pPr()
        successors = PPR_AFTER_SHD
    old = pr.find(qn("w:shd"))
    if old is not None:
        pr.remove(old)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    pr.insert_element_before(shd, *successors)


def para_border(p, side="bottom", color="D8DEE4", sz=6):
    pPr = p._p.get_or_add_pPr()
    pbdr = pPr.find(qn("w:pBdr"))
    if pbdr is None:
        pbdr = OxmlElement("w:pBdr")
        pPr.insert_element_before(pbdr, *PPR_AFTER_PBDR)
    el = OxmlElement(f"w:{side}")
    el.set(qn("w:val"), "single")
    el.set(qn("w:sz"), str(sz))
    el.set(qn("w:space"), "4")
    el.set(qn("w:color"), color)
    pbdr.append(el)


INLINE_RE = re.compile(r"(\*\*.+?\*\*|`[^`]+`|\*[^*\n]+?\*)")


def add_inline(p, text, size=10.5, color=INK, base_bold=False, mono_bg=True):
    text = text.replace("\\$", "$").replace("\\_", "_").replace("\\*", "*")
    for tok in INLINE_RE.split(text):
        if not tok:
            continue
        if tok.startswith("**") and tok.endswith("**") and len(tok) > 4:
            r = p.add_run(tok[2:-2])
            set_run_font(r, LATIN, size, bold=True, color=color)
        elif tok.startswith("`") and tok.endswith("`") and len(tok) > 2:
            r = p.add_run(tok[1:-1])
            set_run_font(r, MONO, size - 1.0, color=RGBColor(0x8A, 0x2B, 0x2B))
            if mono_bg:
                r.font.highlight_color = None
        elif tok.startswith("*") and tok.endswith("*") and len(tok) > 2:
            r = p.add_run(tok[1:-1])
            set_run_font(r, LATIN, size, italic=True, color=color, bold=base_bold)
        else:
            r = p.add_run(tok)
            set_run_font(r, LATIN, size, bold=base_bold, color=color)


def add_heading(doc, level, text, first=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.keep_with_next = True
    if level == 1:
        pf.space_before = Pt(0 if first else 6)
        pf.space_after = Pt(10)
        if not first:
            pf.page_break_before = True
        add_inline(p, text, size=17, color=H1C, base_bold=True)
        for r in p.runs:
            r.font.bold = True
        para_border(p, "bottom", "0F2E4C", 8)
    elif level == 2:
        pf.space_before = Pt(16)
        pf.space_after = Pt(6)
        add_inline(p, text, size=13, color=H2C, base_bold=True)
        for r in p.runs:
            r.font.bold = True
    elif level == 3:
        pf.space_before = Pt(12)
        pf.space_after = Pt(4)
        add_inline(p, text, size=11.5, color=H3C, base_bold=True)
        for r in p.runs:
            r.font.bold = True
    else:
        pf.space_before = Pt(9)
        pf.space_after = Pt(3)
        add_inline(p, text, size=10.5, color=MUTED, base_bold=True)
        for r in p.runs:
            r.font.bold = True
    return p


def add_body(doc, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_before = Pt(0)
    pf.space_after = Pt(7)
    pf.line_spacing = 1.55
    pf.first_line_indent = Pt(0)
    add_inline(p, text, size=10.5)
    return p


def add_bullet(doc, text, level=0, numbered=False):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.62 + 0.62 * level)
    pf.first_line_indent = Cm(-0.42)
    pf.space_before = Pt(0)
    pf.space_after = Pt(4)
    pf.line_spacing = 1.45
    marker = "•" if not numbered else None
    if marker:
        r = p.add_run(marker + " ")
        set_run_font(r, LATIN, 10.5, color=H2C, bold=True)
    add_inline(p, text, size=10.5)
    return p


def add_quote(doc, text):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.7)
    pf.space_before = Pt(4)
    pf.space_after = Pt(8)
    pf.line_spacing = 1.45
    para_border(p, "left", "B45F06", 12)
    add_inline(p, text, size=10, color=RGBColor(0x3A, 0x3A, 0x3A))
    for r in p.runs:
        r.font.italic = True
    return p


def add_code(doc, lines):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(0.3)
    pf.right_indent = Cm(0.3)
    pf.space_before = Pt(6)
    pf.space_after = Pt(9)
    pf.line_spacing = 1.0
    shade(p._p, "F4F6F8")
    para_border(p, "left", "C9D2DA", 12)
    for i, ln in enumerate(lines):
        r = p.add_run(ln)
        set_run_font(r, MONO, 7.4, color=RGBColor(0x24, 0x29, 0x2E))
        if i < len(lines) - 1:
            r.add_break()
    return p


def set_cell(cell, text, header=False, size=8.6):
    cell.text = ""
    p = cell.paragraphs[0]
    pf = p.paragraph_format
    pf.space_before = Pt(2)
    pf.space_after = Pt(2)
    pf.line_spacing = 1.28
    add_inline(p, text, size=size, color=RGBColor(0x0F, 0x2E, 0x4C) if header else INK,
               base_bold=header)
    if header:
        for r in p.runs:
            r.font.bold = True
    shade(cell._tc, "E8EEF3" if header else "FFFFFF")


def add_table(doc, rows):
    header, body = rows[0], rows[1:]
    ncol = len(header)
    t = doc.add_table(rows=1 + len(body), cols=ncol)
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True
    tblPr = t._tbl.tblPr
    tblW = OxmlElement("w:tblW")
    tblW.set(qn("w:type"), "pct")
    tblW.set(qn("w:w"), "5000")
    tblPr.insert_element_before(tblW, *TBLPR_AFTER_TBLW)
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:val"), "single")
        el.set(qn("w:sz"), "4")
        el.set(qn("w:space"), "0")
        el.set(qn("w:color"), "D3DAE1")
        borders.append(el)
    tblPr.insert_element_before(borders, *TBLPR_AFTER_BORDERS)
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "autofit")
    tblPr.insert_element_before(layout, *TBLPR_AFTER_LAYOUT)
    for j, cell_text in enumerate(header):
        set_cell(t.rows[0].cells[j], cell_text, header=True)
    for i, row in enumerate(body, start=1):
        for j in range(ncol):
            val = row[j] if j < len(row) else ""
            set_cell(t.rows[i].cells[j], val)
    # repeat header row on page breaks
    trPr = t.rows[0]._tr.get_or_add_trPr()
    tblHeader = OxmlElement("w:tblHeader")
    tblHeader.set(qn("w:val"), "true")
    trPr.append(tblHeader)
    sp = doc.add_paragraph()
    sp.paragraph_format.space_after = Pt(4)
    sp.paragraph_format.line_spacing = 1.0
    for r in sp.runs:
        r.font.size = Pt(4)
    return t


def parse_table_row(line):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [c.strip() for c in line.split("|")]


def is_sep(line):
    s = line.strip()
    if not s.startswith("|"):
        return False
    return bool(re.fullmatch(r"\|[\s:\-|]+\|?", s)) and "-" in s


def build(md_path, out_path):
    with open(md_path, encoding="utf-8") as f:
        lines = f.read().split("\n")

    # drop front matter (title / subtitle / meta) — already rendered on the cover
    if lines and lines[0].startswith("# "):
        for k in range(1, min(14, len(lines))):
            if lines[k].strip() == "---":
                lines = lines[k + 1:]
                break

    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(2.1)
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.0)

    style = doc.styles["Normal"]
    style.font.name = LATIN
    style.font.size = Pt(10.5)
    style.element.rPr.rFonts.set(qn("w:eastAsia"), CJK)

    # ---------- cover ----------
    for _ in range(7):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run("TECHNICAL SURVEY  /  2026")
    set_run_font(r, LATIN, 9, bold=True, color=ACCENT)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.2
    r = p.add_run("序列感知反欺诈")
    set_run_font(r, LATIN, 34, bold=True, color=H1C)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(18)
    p.paragraph_format.line_spacing = 1.2
    r = p.add_run("Sequence-Aware Fraud Detection")
    set_run_font(r, LATIN, 20, bold=False, color=H2C)

    para_border(p, "bottom", "B45F06", 10)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.line_spacing = 1.5
    r = p.add_run("以 Ramp「每笔授权跑一个 Transformer」为锚点\n论文地图 · 业界实践 · 风险清单 · 落地手册")
    set_run_font(r, LATIN, 12, color=MUTED)

    for _ in range(9):
        doc.add_paragraph()

    info = [
        ("版本", "v1.0"),
        ("日期", "2026-10-24"),
        ("范围", "发卡 / 收单 / ATO / AML / 信贷 / 保险 / 链上"),
        ("参考文献", "arXiv 论文 30+ 篇、工程博客 4 篇"),
    ]
    t = doc.add_table(rows=len(info), cols=2)
    t.autofit = False
    for i, (k, v) in enumerate(info):
        c0, c1 = t.rows[i].cells
        c0.width = Cm(3.2)
        c1.width = Cm(11.5)
        set_cell(c0, k, size=9)
        set_cell(c1, v, size=9)
        for pp in c0.paragraphs:
            for rr in pp.runs:
                rr.font.bold = True
                rr.font.color.rgb = MUTED

    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ---------- toc ----------
    h = doc.add_paragraph()
    h.paragraph_format.space_after = Pt(12)
    r = h.add_run("目　录")
    set_run_font(r, LATIN, 16, bold=True, color=H1C)
    para_border(h, "bottom", "0F2E4C", 8)

    toc = []
    in_fence = False
    for l in lines:
        if l.strip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if l.startswith("# "):
            toc.append(l[2:].strip())
    for title in toc:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(5)
        p.paragraph_format.line_spacing = 1.3
        add_inline(p, title, size=10.5, color=INK)

    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # ---------- body ----------
    i = 0
    n = len(lines)
    first_h1 = True
    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        s = line.strip()

        if not s:
            i += 1
            continue

        if s.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i].rstrip("\n"))
                i += 1
            i += 1
            add_code(doc, buf if buf else [""])
            continue

        if s == "---":
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", s)
        if m:
            lvl = len(m.group(1))
            add_heading(doc, lvl, m.group(2).strip(), first=(lvl == 1 and first_h1))
            if lvl == 1:
                first_h1 = False
            i += 1
            continue

        if is_sep(s):
            # collect full table block (header line was previous)
            i += 1
            continue

        if s.startswith("|"):
            rows = []
            header = parse_table_row(s)
            i += 1
            if i < n and is_sep(lines[i]):
                i += 1
            rows.append(header)
            while i < n and lines[i].strip().startswith("|"):
                if is_sep(lines[i]):
                    i += 1
                    continue
                rows.append(parse_table_row(lines[i]))
                i += 1
            add_table(doc, rows)
            continue

        if s.startswith(">"):
            buf = [s[1:].strip()]
            i += 1
            while i < n and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip()[1:].strip())
                i += 1
            add_quote(doc, " ".join(buf))
            continue

        mb = re.match(r"^(\s*)[-*]\s+(.*)$", raw)
        if mb:
            indent = len(mb.group(1))
            add_bullet(doc, mb.group(2).strip(), level=min(indent // 2, 2))
            i += 1
            continue

        mn = re.match(r"^(\s*)\d+\.\s+(.*)$", raw)
        if mn:
            indent = len(mn.group(1))
            p = doc.add_paragraph()
            pf = p.paragraph_format
            pf.left_indent = Cm(0.62 + 0.62 * min(indent // 2, 2))
            pf.first_line_indent = Cm(-0.42)
            pf.space_after = Pt(4)
            pf.line_spacing = 1.45
            num = re.match(r"^\s*(\d+)\.", raw).group(1)
            r = p.add_run(f"{num}. ")
            set_run_font(r, LATIN, 10.5, bold=True, color=H2C)
            add_inline(p, mn.group(2).strip(), size=10.5)
            i += 1
            continue

        add_body(doc, s)
        i += 1

    # footer page numbers
    footer = doc.sections[0].footer
    fp = footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER

    def fld(kind):
        r = fp.add_run()
        set_run_font(r, LATIN, 8, color=MUTED)
        el = OxmlElement("w:fldChar")
        el.set(qn("w:fldCharType"), kind)
        r._r.append(el)

    fld("begin")
    r = fp.add_run()
    set_run_font(r, LATIN, 8, color=MUTED)
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    r._r.append(instr)
    fld("separate")
    r = fp.add_run("1")
    set_run_font(r, LATIN, 8, color=MUTED)
    fld("end")

    doc.save(out_path)
    print(f"OK -> {out_path}")


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2])
