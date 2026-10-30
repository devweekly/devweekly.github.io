#!/usr/bin/env python3
"""SEC S-1 HTML → Markdown。

SEC 的 HTML 用绝对定位逐行排版：每个视觉行是一个 <div style="top:XXpt">，
行内文本被拆成若干 <font style="left:YYpt;font-weight:...">。

两点是通用转换器做不到的：

1. 段落重建 —— 按 top 的行距判断：段内行距 ≈ 字号 × 1.2，段间明显更大。
2. 强调还原 —— 加粗/斜体是 font 级属性，一条句子常跨多个视觉行。
   这里先按行收集 run，合并成段后再统一加 ** / *，避免标记断在行边界。
"""
import re
import sys
from html.parser import HTMLParser

SKIP = {"script", "style"}
BULLET_RE = re.compile(r"^[•▪◦‣·]\s*")
PARA_GAP = 1.35


def squeeze(s):
    """压空白但保留首尾各一个空格 —— run 拼接时靠它补空格。"""
    s = s.replace("\xa0", " ").replace("\u200b", "")
    s = re.sub(r"\s+", " ", s)
    return s


def style_of(attrs):
    out = {}
    for part in dict(attrs).get("style", "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def num(style, key, default=None):
    m = re.match(r"-?([\d.]+)", style.get(key, ""))
    return float(m.group(1)) if m else default


class DocParser(HTMLParser):
    """按文档流产出 line / table 条目。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.runs = []
        self.div = None
        self.font = None
        self.skip = 0
        self.tdepth = 0
        self.rows, self.row, self.cell = [], [], []
        self.in_cell = False
        self.table_top = None

    def _close_line(self):
        if self.div is None:
            return
        # 同一视觉行内，两个 font 之间是否该有空格由几何位置决定：
        # 前一个 font 的 left+width 与后一个的 left 有间隙才补空格，
        # 否则会把 "selected" 这种被 kerning 拆成两截的词粘出 "se lected"。
        runs = []
        prev_right = None
        for text, bold, italic, left, width in self.runs:
            text = squeeze(text)
            if not text.strip():
                continue
            if prev_right is not None and left is not None and not text.startswith(" "):
                if left - prev_right > 1.2:
                    text = " " + text
            if left is not None and width:
                prev_right = left + width
            runs.append((text, bold, italic))
        if runs:
            self.items.append(("line", self.div.get("top"), runs,
                               self.div.get("size") or 10.0))
        self.runs = []
        self.div = None

    def handle_starttag(self, tag, attrs):
        if tag in SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        if tag == "table":
            if self.tdepth == 0:
                self._close_line()
                self.table_top = self.div.get("top") if self.div else None
                self.rows, self.row = [], []
            self.tdepth += 1
            return
        if tag == "img":
            src = dict(attrs).get("src", "")
            if src and not src.startswith("data:"):
                self._close_line()
                self.items.append(("img", None, f"images/{src.lstrip('./')}", 0))
            return
        if self.tdepth:
            if tag == "tr" and self.tdepth == 1:
                self.row = []
            elif tag in ("td", "th") and self.tdepth == 1:
                self.cell, self.in_cell = [], True
            elif tag == "br" and self.in_cell:
                self.cell.append(" ")
            elif tag == "div":
                self._close_line()
            return
        if tag == "div":
            self._close_line()
            st = style_of(attrs)
            self.div = {"top": num(st, "top"), "size": num(st, "font-size")}
        elif tag == "font":
            st = style_of(attrs)
            self.font = {
                "bold": st.get("font-weight") == "bold",
                "italic": st.get("font-style") == "italic",
                "size": num(st, "font-size"),
                "left": num(st, "left"),
                "width": num(st, "width"),
            }
            if self.div is not None and self.font["size"]:
                cur = self.div.get("size")
                if cur is None or cur >= 11.5:  # div 上的 12pt 是容器默认值
                    self.div["size"] = self.font["size"]
        elif tag == "br" and not self.tdepth:
            self.runs.append((" ", False, False, None, None))

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag == "table":
            self.tdepth -= 1
            if self.tdepth == 0:
                if any(self.row):
                    self.rows.append(self.row)
                if self.rows:
                    self.items.append(("table", self.table_top, self.rows, 0))
                self.rows, self.row = [], []
            return
        if self.tdepth:
            if tag in ("td", "th") and self.tdepth == 1:
                self.row.append(" ".join("".join(self.cell).split()))
                self.in_cell, self.cell = False, []
            elif tag == "tr" and self.tdepth == 1:
                if any(self.row):
                    self.rows.append(self.row)
            return
        if tag == "font":
            self.font = None
        elif tag == "div":
            self._close_line()

    def handle_data(self, data):
        if self.skip:
            return
        if self.in_cell:
            self.cell.append(data)
            return
        if self.div is None:
            return
        f = self.font or {"bold": False, "italic": False, "left": None, "width": None}
        self.runs.append((data, f["bold"], f["italic"], f.get("left"), f.get("width")))


def norm(s):
    s = s.replace("’", "'").lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def table_to_md(rows):
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    keep = [i for i in range(width) if any(r[i].strip() for r in rows)]
    if keep:
        rows = [[r[i] for i in keep] for r in rows]
        width = len(keep)
    cells = [c for r in rows for c in r if c]
    long_cells = sum(1 for c in cells if len(c) > 80)
    if width < 2 or (cells and long_cells / len(cells) > 0.5):
        return [" ".join(c for c in r if c) for r in rows if any(r)]
    out = ["| " + " | ".join(c.replace("|", "\\|") or " " for c in rows[0]) + " |",
           "|" + "|".join(["---"] * width) + "|"]
    for r in rows[1:]:
        out.append("| " + " | ".join(c.replace("|", "\\|") or " " for c in r) + " |")
    return out


def join_runs(runs):
    """把多个 run 拼成连续文本，run 之间缺空格就补一个。"""
    out = ""
    for text, _, _ in runs:
        if not text:
            continue
        if out and not out.endswith(" ") and not text.startswith(" "):
            out += " "
        out += text
    return re.sub(r"\s{2,}", " ", out).strip()


def _needs_space(left, right):
    if not left or not right:
        return False
    if left.endswith(" ") or right.startswith(" "):
        return False
    if left[-1] == "$":
        return bool(right) and not right[0].isdigit()
    if left[-1] in "(/-—–“‘[{":
        return False
    if right[0] in "%,.;:)]}—–”’!?":
        return False
    return True


def render(runs, bold=False, italic=False):
    """按样式变化插入 ** / *，整块统一加粗时不重复标记。"""
    merged = []
    for text, b, i in runs:
        if not text:
            continue
        key = (b and not bold, i and not italic)
        if merged and merged[-1][1] == key:
            merged[-1][0] += text
        else:
            merged.append([text, key])
    parts = []
    for text, (b, i) in merged:
        if not text.strip():
            parts.append(text)
            continue
        lead = " " if text.startswith(" ") else ""
        tail = " " if text.endswith(" ") else ""
        core = text.strip()
        if b:
            core = "**" + core + "**"
        if i:
            core = "*" + core + "*"
        parts.append(lead + core + tail)
    s = "".join(parts)
    s = re.sub(r"\s{2,}", " ", s)
    return s.strip()


def build_blocks(items, toc_norm):
    blocks, cur = [], None
    prev_top = None

    def close():
        nonlocal cur
        if cur:
            blocks.append(cur)
            cur = None

    for kind, top, payload, size in items:
        if kind == "table":
            close()
            blocks.append({"kind": "table", "rows": payload})
            prev_top = None
            continue
        if kind == "img":
            close()
            blocks.append({"kind": "img", "src": payload})
            prev_top = None
            continue
        runs = payload
        text = join_runs(runs)
        if not text:
            continue
        if re.fullmatch(r"\d{1,3}", text) or text == "Table of Contents":
            continue
        all_bold = all(b for t, b, _ in runs if t.strip())
        gap = (top - prev_top) if (top is not None and prev_top is not None) else 999.0
        new = (cur is None
               or gap > size * PARA_GAP
               or all_bold != cur["bold"]
               or abs(size - cur["size"]) > 0.5)
        if new:
            close()
            cur = {"kind": "head" if all_bold else "para", "bold": all_bold,
                   "runs": [], "size": size}
        if cur["runs"]:
            # 续接空格写进上一个 run，避免跨行的斜体/加粗被空格切断
            t, b, i = cur["runs"][-1]
            if not t.endswith(" "):
                cur["runs"][-1] = (t + " ", b, i)
        cur["runs"].extend(runs)
        prev_top = top

    close()

    for b in blocks:
        if b["kind"] in ("table", "img"):
            continue
        b["text"] = join_runs(b["runs"])
        if b["kind"] == "head":
            t = b["text"]
            in_toc = norm(t) in toc_norm
            if len(t) > 220 or (len(t.split()) < 2 and not in_toc):
                b["kind"] = "para"
                b["bold"] = False  # 降级后要按行内加粗渲染
            elif in_toc:
                b["level"] = 2
                b["text"] = fix_heading_spacing(t, toc_norm)
            else:
                b["level"] = 3
                b["text"] = fix_heading_spacing(t, toc_norm)
                if norm(b["text"]) in toc_norm:
                    b["level"] = 2
    return blocks


def fix_heading_spacing(t, toc_norm):
    """标题偶尔丢空格（"Principaland"）或逐字母被拆开（"a n d"）：按目录名反推。"""
    # 逐字母拆开的先合回去
    t = re.sub(r"(?<![A-Za-z])(?:[A-Za-z] ){2,}[A-Za-z](?![A-Za-z])",
               lambda m: m.group(0).replace(" ", ""), t)
    if norm(t) in toc_norm:
        return t
    for i in range(3, len(t) - 3):
        if t[i] == " ":
            continue
        cand = t[:i] + " " + t[i:]
        if norm(cand) in toc_norm:
            return cand
    return t


def convert(src_path, out_path):
    raw = open(src_path, encoding="utf-8", errors="replace").read()
    p = DocParser()
    p.feed(raw)

    toc_norm = set()
    for kind, _, rows, _ in p.items:
        if kind != "table":
            continue
        for row in rows:
            if len(row) < 2:
                continue
            a, b = row[0].strip(), row[1].strip()
            if (re.fullmatch(r"[A-Z][A-Z0-9 ,.\-’'&/()]+", a)
                    and re.fullmatch(r"F?-?\d+", b) and len(a) > 3):
                toc_norm.add(norm(a))

    blocks = build_blocks(p.items, toc_norm)

    out = []
    for b in blocks:
        if b["kind"] == "table":
            md = table_to_md(b["rows"])
            if md:
                out.extend(md)
                out.append("")
            continue
        if b["kind"] == "img":
            out.append(f"![]({b['src']})")
            out.append("")
            continue
        text = render(b["runs"], bold=b["bold"])
        if b["kind"] == "head":
            out.append("#" * b["level"] + " " + b["text"].replace("*", ""))
            out.append("")
        elif BULLET_RE.match(text):
            out.append("- " + BULLET_RE.sub("", text))
        else:
            out.append(text)
            out.append("")

    text = re.sub(r"\n{3,}", "\n\n", "\n".join(out))
    open(out_path, "w", encoding="utf-8").write(text)
    heads = [l for l in text.split("\n") if l.startswith("#")]
    print(f"items={len(p.items)} blocks={len(blocks)} chars={len(text)} "
          f"h2={sum(h.startswith('## ') for h in heads)} "
          f"h3={sum(h.startswith('### ') for h in heads)} "
          f"bold={text.count('**') // 2}")


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
