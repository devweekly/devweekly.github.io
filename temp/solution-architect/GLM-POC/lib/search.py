"""打分搜索 - rg 命中 + 可解释打分(breakdown)。

打分公式输出 score + breakdown,architect 能看出每个文件为什么得这个分。
"""
from __future__ import annotations

import json
import logging
import re
import subprocess
from collections import defaultdict
from pathlib import Path

from .schemas import BusinessFlow, SearchHit, ScoredFile

logger = logging.getLogger(__name__)


def search_and_rank(
    target_repos: list[str],
    keywords: list[str],
    index_dir: str | Path,
    repos_root: str | Path | None = None,
    top_k: int = 20,
    hint: str | None = None,
) -> list[ScoredFile]:
    """搜索 + 打分排序,返回 Top K 文件。

    Args:
        target_repos: 要搜索的 repo 名列表
        keywords: 搜索关键词列表
        index_dir: 索引目录(读 business_flow.jsonl + config.json)
        repos_root: repo 根目录。None 时自动从 index/config.json 读取
        top_k: 返回前 K 个文件
        hint: 用户额外提示,注入打分( hint 里的词命中加分)

    Returns:
        打分排序后的 Top K 文件列表,每个文件带 breakdown
    """
    if not keywords:
        logger.warning("无关键词,跳过搜索")
        return []

    index_dir = Path(index_dir)

    # 自动从 config.json 读 repos_root
    if repos_root is None:
        from .scan import load_config
        config = load_config(index_dir)
        repos_root_str = config.get("repos_root")
        if repos_root_str:
            repos_root = Path(repos_root_str)
        else:
            logger.error("无法从 index/config.json 读取 repos_root,请传 --repos-root")
            return []
    repos_root = Path(repos_root)

    # 从 hint 提取额外加权词
    hint_words = _extract_hint_words(hint) if hint else []

    # 1. 用 rg 拿命中
    hits = _run_rg(keywords, target_repos, repos_root)
    if not hits:
        logger.info("rg 无命中")
        return []
    logger.info(f"rg 命中 {len(hits)} 处,涉及 {len({h.file for h in hits})} 个文件")

    # 2. 加载 business_flow 给文件打标签
    file_flows = _load_business_flow(index_dir)

    # 3. 按文件聚合命中
    file_hits: dict[str, list[SearchHit]] = defaultdict(list)
    for hit in hits:
        file_hits[hit.file].append(hit)

    # 4. 打分
    scored: list[ScoredFile] = []
    for file_path, hit_list in file_hits.items():
        flow = file_flows.get(file_path)
        score, breakdown = _score_file(file_path, hit_list, flow, hint_words)
        repo_name = flow.repo if flow else _extract_repo_name(file_path, repos_root)
        scored.append(ScoredFile(
            file=file_path,
            repo=repo_name,
            score=score,
            breakdown=breakdown,
            tags=flow.tags if flow else [],
            hits=hit_list,
        ))

    # 5. 归一化(0-100,不需要调权重)
    if scored:
        raw_scores = [s.score for s in scored]
        min_s, max_s = min(raw_scores), max(raw_scores)
        if max_s > min_s:
            for s in scored:
                s.score = int(100 * (s.score - min_s) / (max_s - min_s))
        else:
            for s in scored:
                s.score = 100

    # 6. 排序
    scored.sort(key=lambda x: x.score, reverse=True)

    top_files = scored[:top_k]
    logger.info(f"打分完成(归一化后),Top {len(top_files)} 文件")
    for i, sf in enumerate(top_files[:5], 1):
        logger.info(f"  [{i}] score={sf.score} {sf.file}")
        logger.info(f"      breakdown={sf.breakdown}")

    return top_files


def _run_rg(
    keywords: list[str],
    target_repos: list[str],
    repos_root: Path,
) -> list[SearchHit]:
    """调用 rg --json 搜索,返回结构化命中"""
    # 构造正则:用 | 连接所有关键词
    # 通配符 * 转成 \w* 让 naming pattern 生效
    patterns = []
    for kw in keywords:
        # 支持 naming pattern 中的 * 通配符
        if "*" in kw:
            regex_kw = kw.replace("*", r"\w*")
            patterns.append(regex_kw)
        else:
            patterns.append(re.escape(kw))

    regex = "|".join(patterns)

    # 搜索每个 target repo
    all_hits: list[SearchHit] = []
    for repo_name in target_repos:
        repo_path = repos_root / repo_name
        if not repo_path.exists():
            logger.warning(f"repo 不存在: {repo_path}")
            continue

        cmd = [
            "rg", "--json", "-i", "-w",  # case insensitive, word boundary
            regex, str(repo_path),
        ]
        # 排除目录
        for ignore in [".git", "node_modules", "vendor", "dist", "build", "test", "tests"]:
            cmd.extend(["-g", f"!{ignore}/**"])

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, check=False,
            )
            if result.returncode not in (0, 1):  # 0=有命中,1=无命中
                logger.warning(f"rg 异常 (exit={result.returncode}): {result.stderr[:200]}")
                continue

            hits = _parse_rg_json(result.stdout, keywords)
            all_hits.extend(hits)
        except FileNotFoundError:
            logger.error("rg 未安装,请运行: brew install ripgrep")
            return []

    return all_hits


def _parse_rg_json(json_output: str, keywords: list[str]) -> list[SearchHit]:
    """解析 rg --json 的输出"""
    hits: list[SearchHit] = []
    for line in json_output.splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue

        if obj.get("type") != "match":
            continue

        data = obj.get("data", {})
        file_path = data.get("path", {}).get("text", "")
        line_num = data.get("line_number", 0)
        matched_text = data.get("lines", {}).get("text", "")

        # 判断命中的是哪个关键词
        matched_keyword = ""
        for kw in keywords:
            if kw.lower() in matched_text.lower():
                matched_keyword = kw
                break
        if not matched_keyword and keywords:
            matched_keyword = keywords[0]

        # 判断命中位置语义
        in_class_name = bool(re.search(
            rf"\bclass\s+\w*{re.escape(matched_keyword)}\w*", matched_text, re.IGNORECASE
        ))
        in_method_name = bool(re.search(
            rf"\b(?:def|func|function)\s+\w*{re.escape(matched_keyword)}\w*",
            matched_text, re.IGNORECASE
        ))
        in_comment = matched_text.strip().startswith(("//", "#", "*", "--"))

        hits.append(SearchHit(
            file=file_path,
            line=line_num,
            keyword=matched_keyword,
            matched_text=matched_text.strip()[:200],
            in_class_name=in_class_name,
            in_method_name=in_method_name,
            in_comment=in_comment,
        ))

    return hits


def _score_file(
    file_path: str,
    hits: list[SearchHit],
    flow: BusinessFlow | None,
    hint_words: list[str] | None = None,
) -> tuple[int, dict[str, int]]:
    """打分,返回 (score, breakdown)

    breakdown 让 architect 能看出每个文件为什么得这个分。
    hint_words: 用户 hint 里提取的词,命中额外加分。
    """
    breakdown: dict[str, int] = {}

    # 1. 命中关键词种类(去重)— 主要信号
    unique_keywords = {h.keyword for h in hits if h.keyword}
    breakdown["keyword_variety"] = len(unique_keywords) * 10

    # 2. 命中位置语义权重
    breakdown["hit_in_class_name"] = sum(20 for h in hits if h.in_class_name)
    breakdown["hit_in_method_name"] = sum(15 for h in hits if h.in_method_name)
    breakdown["hit_in_comment"] = sum(2 for h in hits if h.in_comment)

    # 3. 文件业务标签(入口性)
    breakdown["is_entry"] = 20 if (flow and flow.has_inbound) else 0
    breakdown["is_producer"] = 10 if (flow and flow.has_outbound) else 0
    breakdown["has_tags"] = min(len(flow.tags) * 2, 20) if flow else 0

    # 4. 目录权重
    path_lower = file_path.lower()
    breakdown["in_src_main"] = 15 if "/src/main/" in path_lower else 0
    breakdown["in_app"] = 10 if "/app/" in path_lower or "/cmd/" in path_lower else 0
    breakdown["in_service_dir"] = 15 if "/service" in path_lower or "/controller" in path_lower else 0
    breakdown["in_test"] = -20 if "/test/" in path_lower or "/tests/" in path_lower else 0
    breakdown["in_vendor"] = -100 if "/vendor/" in path_lower or "/node_modules/" in path_lower else 0

    # 5. 文件大小惩罚(超大文件信号密度低)
    if flow and flow.line_count > 0:
        breakdown["size_penalty"] = -min(flow.line_count // 500, 20)
    else:
        breakdown["size_penalty"] = 0

    # 6. hint 加权(用户额外提示里的词在文件 tags 里命中加分)
    if hint_words and flow:
        hint_match = sum(
            15 for hw in hint_words
            if any(hw.lower() in tag.lower() for tag in flow.tags)
        )
        breakdown["hint_match"] = hint_match
    else:
        breakdown["hint_match"] = 0

    score = sum(breakdown.values())
    return score, breakdown


def _extract_hint_words(hint: str) -> list[str]:
    """从用户 hint 提取关键词(简单分词,不需要 LLM)"""
    # 去停用词 + 按空格/标点分词
    stop_words = {
        "的", "了", "在", "是", "和", "与", "或", "但", "如果",
        "因为", "所以", "给", "让", "做", "要", "会", "能", "可以",
        "应该", "重点", "关注", "注意", "看", "找", "查", "搜",
        "这个", "那个", "这些", "那些", "一些", "一下",
        "the", "a", "an", "is", "are", "was", "were",
        "focus", "on", "look", "for", "find", "search",
    }
    import re
    words = re.findall(r'[\w]+', hint)
    return [w for w in words if w.lower() not in stop_words and len(w) > 1]


def _load_business_flow(index_dir: Path) -> dict[str, BusinessFlow]:
    """加载 business_flow.jsonl"""
    path = index_dir / "business_flow.jsonl"
    flows: dict[str, BusinessFlow] = {}
    if not path.exists():
        logger.warning(f"business_flow.jsonl 不存在: {path}")
        return flows

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                data = json.loads(line)
                flow = BusinessFlow(**data)
                flows[flow.file] = flow
            except Exception as e:
                logger.warning(f"解析 business_flow 行失败: {e}")
    return flows


def _extract_repo_name(file_path: str, repos_root: Path) -> str:
    """从文件路径反推 repo 名"""
    try:
        rel = Path(file_path).relative_to(repos_root)
        return rel.parts[0] if rel.parts else ""
    except ValueError:
        return ""
