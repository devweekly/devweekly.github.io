"""验证回路 - 对 LLM 输出的 Impact Map 做三重验证。

DeepSeek R1 提的"验证回路"概念:LLM 是加速器,不是裁判。
拿到 Impact Map 后,必须用 git log + rg 验证 LLM 没胡说。
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from .schemas import ImpactMap, CoreChange, DownstreamImpact, Unknown

logger = logging.getLogger(__name__)


def verify_impact_map(
    impact_map: ImpactMap,
    index_dir: str | Path,
) -> ImpactMap:
    """对 Impact Map 做三重验证,返回修正后的版本。

    验证内容:
    1. 每个 core_change 的文件最近半年真的在改这个事(git log)
    2. downstream_impacts 是否完整(rg 搜调用方)
    3. unknowns 必须是具体问题,不是"需要进一步确认"

    Args:
        impact_map: LLM 生成的 Impact Map
        index_dir: 索引目录(用于加载 capabilities 验证下游)

    Returns:
        修正后的 Impact Map(深拷贝,不改原对象)
    """
    verified = impact_map.model_copy(deep=True)

    # 1. 验证 core_change 的 git 历史
    for change in verified.core_changes:
        git_history = _verify_file_git_history(change.file)
        change.git_history = git_history
        if not git_history:
            change.confidence = "low"
            logger.info(f"core_change 无 git 历史,降为低置信: {change.file}")

    # 2. 验证 downstream_impacts 完整性
    for impact in verified.downstream_impacts:
        if impact.impact_type in ("breaking", "additive"):
            additional = _verify_downstream_callers(impact.target, index_dir)
            missing = set(additional) - set(impact.affected_repos)
            if missing:
                impact.affected_repos.extend(missing)
                impact.verification_note = (
                    f"verify.py 补充发现 {len(missing)} 个未列出调用方: "
                    f"{', '.join(list(missing)[:5])}"
                )
                logger.info(
                    f"downstream_impact 补充 {len(missing)} 个调用方: {impact.target}"
                )

    # 3. unknowns 必须是具体问题
    for u in verified.unknowns:
        if _is_vague_question(u.question):
            u.question = f"[需具体化] {u.question}"
            logger.info(f"unknown 标记为需具体化: {u.question}")

    return verified


def _verify_file_git_history(file_path: str) -> list[str]:
    """验证文件最近半年的 git 历史"""
    path = Path(file_path)
    if not path.exists():
        return []

    repo_root = _find_repo_root(path)
    if not repo_root:
        return []

    try:
        result = subprocess.run(
            [
                "git", "-C", str(repo_root),
                "log", "--since=6 months ago",
                "--oneline", "-n", "5",
                "--", str(path),
            ],
            capture_output=True, text=True, check=False,
        )
        if result.returncode != 0:
            return []
        return [line for line in result.stdout.strip().splitlines() if line]
    except Exception:
        return []


def _verify_downstream_callers(
    target: str,
    index_dir: str | Path,
) -> list[str]:
    """用 rg 搜 target 的调用方,验证 LLM 列的下游是否完整。

    从 capabilities.jsonl 里找谁引用了 target。
    """
    index_dir = Path(index_dir)
    cap_path = index_dir / "capabilities.jsonl"
    if not cap_path.exists():
        return []

    callers: set[str] = set()
    with open(cap_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                import json
                cap = json.loads(line)
            except Exception:
                continue

            # 如果某个 capability 的 value 包含 target,说明这个 repo 用了它
            if target.lower() in cap.get("value", "").lower():
                callers.add(cap.get("repo", ""))

    callers.discard("")
    return list(callers)


def _is_vague_question(question: str) -> bool:
    """判断问题是否过于模糊"""
    vague_patterns = [
        "需要进一步确认",
        "需要确认",
        "待确认",
        "需进一步",
        "TBD",
        "TODO",
    ]
    if len(question) < 10:
        return True
    for pattern in vague_patterns:
        if pattern in question:
            return True
    return False


def _find_repo_root(file_path: Path) -> Path | None:
    """从文件路径反推 repo 根(找 .git 目录)"""
    p = file_path.parent if file_path.is_file() else file_path
    while p != p.parent:
        if (p / ".git").exists():
            return p
        p = p.parent
    return None
