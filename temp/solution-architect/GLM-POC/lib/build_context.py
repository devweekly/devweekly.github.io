"""Context 拼装 - 把 Top 文件代码 + business tags + git log 拼成 LLM context。

拼装顺序(对应 LLM 注意力优先级):
1. 需求文本(最优先)
2. Repo 档案(背景)
3. Top 文件代码片段 + business tags
4. 跨 repo 数据流(从 capabilities.jsonl 提取)
5. Git 历史(业务背景)
"""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

from .schemas import ScoredFile

logger = logging.getLogger(__name__)

# 每个文件最多截取的代码行数
MAX_LINES_PER_FILE = 80
# 每个文件最多截取的字符数
MAX_CHARS_PER_FILE = 4000
# 最多加载的文件数
MAX_FILES_IN_CONTEXT = 15


def build(
    top_files: list[ScoredFile],
    index_dir: str | Path,
    requirement: str = "",
) -> str:
    """拼装 LLM context。

    Args:
        top_files: 打分后的 Top 文件列表
        index_dir: 索引目录
        requirement: 原始需求文本

    Returns:
        拼装好的 context 字符串
    """
    index_dir = Path(index_dir)
    parts: list[str] = []

    # 1. 需求
    if requirement:
        parts.append(f"## Requirement\n\n{requirement}\n")

    # 2. Top 文件代码片段 + tags
    parts.append("## Top Files (按打分排序)\n")
    files_to_include = top_files[:MAX_FILES_IN_CONTEXT]
    for i, sf in enumerate(files_to_include, 1):
        parts.append(f"### File {i}: {sf.file} (score={sf.score})\n")
        parts.append(f"**Breakdown**: {sf.breakdown}\n")
        if sf.tags:
            parts.append(f"**Business Tags**: {', '.join(sf.tags[:10])}\n")

        # 读代码片段
        snippet = _read_snippet(sf.file, sf.hits)
        if snippet:
            parts.append(f"```\n{snippet}\n```\n")

    # 3. 跨 repo 数据流
    flow_text = _build_cross_repo_flow(top_files, index_dir)
    if flow_text:
        parts.append("## Cross-Repo Data Flow\n\n")
        parts.append(flow_text + "\n")

    # 4. Git 历史(业务背景)
    git_text = _build_git_history(files_to_include)
    if git_text:
        parts.append("## Git History (业务背景)\n\n")
        parts.append(git_text + "\n")

    return "\n".join(parts)


def _read_snippet(file_path: str, hits: list) -> str:
    """读取文件代码片段,优先包含命中行 + 上下文"""
    path = Path(file_path)
    if not path.exists():
        return ""

    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except Exception:
        return ""

    if not lines:
        return ""

    # 如果有命中行,围绕命中行截取
    if hits:
        hit_lines = sorted({h.line for h in hits})
        # 取第一个命中行附近 40 行
        center = hit_lines[0]
        start = max(0, center - 20)
        end = min(len(lines), center + 60)
        snippet_lines = lines[start:end]
        # 标注命中行
        result = []
        for i, line in enumerate(snippet_lines):
            actual_line = start + i + 1
            marker = " >>> " if actual_line in hit_lines else "     "
            result.append(f"{actual_line:4d}{marker}{line}")
        return "\n".join(result)

    # 无命中行,取前 80 行
    snippet_lines = lines[:MAX_LINES_PER_FILE]
    result = []
    for i, line in enumerate(snippet_lines):
        result.append(f"{i+1:4d}     {line}")
    return "\n".join(result)[:MAX_CHARS_PER_FILE]


def _build_cross_repo_flow(
    top_files: list[ScoredFile],
    index_dir: Path,
) -> str:
    """从 capabilities.jsonl 提取跨 repo 数据流"""
    cap_path = index_dir / "capabilities.jsonl"
    if not cap_path.exists():
        return ""

    # 收集 Top 文件涉及的 topic / service / table
    targets: dict[str, set[str]] = {}  # type -> {value}
    for sf in top_files:
        for tag in sf.tags:
            if ":" in tag:
                cap_type, value = tag.split(":", 1)
                targets.setdefault(cap_type, set()).add(value)

    if not targets:
        return ""

    # 从 capabilities.jsonl 找生产者/消费者
    flow_lines: list[str] = []
    cap_file = cap_path
    with open(cap_file, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                cap = json.loads(line)
            except json.JSONDecodeError:
                continue

            cap_type = cap.get("type", "")
            value = cap.get("value", "")

            # 如果这个值在 Top 文件的 tags 里出现过
            if value in targets.get(cap_type, set()):
                repo = cap.get("repo", "?")
                flow = cap.get("flow", "?")
                flow_lines.append(
                    f"- [{cap_type}] {value}: {repo} (flow={flow})"
                )

    # 去重 + 限制数量
    seen = set()
    unique_lines = []
    for line in flow_lines:
        if line not in seen:
            seen.add(line)
            unique_lines.append(line)
            if len(unique_lines) >= 50:
                break

    return "\n".join(unique_lines) if unique_lines else ""


def _build_git_history(top_files: list[ScoredFile]) -> str:
    """提取 Top 文件的 git log(业务背景)"""
    lines: list[str] = []

    for sf in top_files[:5]:  # 只取前 5 个文件的 git log
        file_path = Path(sf.file)
        if not file_path.exists():
            continue

        repo_root = _find_repo_root(file_path)
        if not repo_root:
            continue

        try:
            result = subprocess.run(
                [
                    "git", "-C", str(repo_root),
                    "log", "--oneline", "-n", "5", "--", str(file_path),
                ],
                capture_output=True, text=True, check=False,
            )
            if result.returncode == 0 and result.stdout.strip():
                lines.append(f"### {sf.file}")
                lines.append("```")
                lines.append(result.stdout.strip())
                lines.append("```\n")
        except Exception:
            continue

    return "\n".join(lines)


def _find_repo_root(file_path: Path) -> Path | None:
    """从文件路径反推 repo 根(找 .git 目录)"""
    p = file_path.parent
    while p != p.parent:
        if (p / ".git").exists():
            return p
        p = p.parent
    return None
