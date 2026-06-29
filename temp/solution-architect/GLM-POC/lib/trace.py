"""线索追踪 - 从 Top 文件提取下游线索,用 LLM 筛选。

复用 recipes.yaml 配方表,只取 flow=out 的出口线索。
避免 architect 陷入"搜→发现→再搜→再发现"的循环。
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from .schemas import Clue, ScoredFile

logger = logging.getLogger(__name__)


def extract_clues(
    top_files: list[ScoredFile],
    recipes: dict[str, Any],
) -> list[Clue]:
    """从 Top 文件重跑配方,只取 flow=out 的出口线索。

    Args:
        top_files: 打分后的 Top 文件列表
        recipes: recipes.yaml 配方表

    Returns:
        出口线索列表(去重)
    """
    clues: list[Clue] = []
    seen: set[tuple[str, str]] = set()  # (type, value) 去重

    for scored_file in top_files:
        file_path = Path(scored_file.file)
        if not file_path.exists():
            continue

        try:
            text = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue

        for recipe in recipes.get("recipes", []):
            # 只取出口线索
            if recipe.get("flow") != "out":
                continue

            # glob 过滤
            glob_pattern = recipe.get("glob")
            if glob_pattern:
                import fnmatch
                if not fnmatch.fnmatch(file_path.name, glob_pattern):
                    continue

            pattern = recipe.get("pattern", "")
            try:
                regex = re.compile(pattern, re.MULTILINE)
            except re.error:
                continue

            for match in regex.finditer(text):
                value = (
                    match.group(match.lastindex or 0)
                    if match.groups()
                    else match.group(0)
                )

                key = (recipe.get("type", ""), value)
                if key in seen:
                    continue
                seen.add(key)

                clues.append(Clue(
                    flow=recipe.get("flow", "out"),
                    type=recipe.get("type", "unknown"),
                    value=value,
                    source_file=scored_file.file,
                ))

    logger.info(f"从 {len(top_files)} 个文件提取 {len(clues)} 条出口线索")
    return clues


def build_clue_prompt(
    clues: list[Clue],
    requirement: str,
) -> str:
    """构造 LLM 线索筛选 prompt。

    让 LLM 判断哪些线索值得第二轮搜索,哪些可以跳过。
    """
    clue_lines = []
    for i, clue in enumerate(clues, 1):
        clue_lines.append(
            f"{i}. [{clue.type}] {clue.value} (来自 {clue.source_file})"
        )

    return f"""你是资深架构师。基于以下需求:

{requirement}

我从 Top 文件中提取了这些下游线索(出口数据流):

{chr(10).join(clue_lines)}

请判断哪些线索值得第二轮搜索(即:追这些线索可能找到更多相关代码)。

判断标准:
- priority_clues: 跟需求直接相关的下游(如需求涉及报表,而线索是 Kafka topic "report-generated")
- skip_clues: 跟需求无关的下游(如线索是 health-check 端点)

输出 JSON:
{{
  "priority_clues": ["线索值1", "线索值2"],
  "skip_clues": ["线索值3"],
  "reason": "简短说明筛选逻辑"
}}
"""


def filter_new_clues(
    clues: list[Clue],
    searched_terms: set[str],
) -> list[Clue]:
    """过滤掉已经搜过的线索"""
    return [c for c in clues if c.value not in searched_terms]
