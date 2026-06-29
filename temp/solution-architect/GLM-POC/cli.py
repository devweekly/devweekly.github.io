#!/usr/bin/env python3
"""Code Search CLI - Solution Architect 代码搜索工具

端到端工作流:
  Phase 0: 索引生成(scan.py)
  Phase 1: 关键词扩展 + Repo 筛选 + 搜索(search.py)
  Phase 2: 线索追踪(trace.py)
  Phase 3: Context 拼装 + LLM 分析 + 验证(build_context + verify)

用法:
  # 生成/更新索引(全量或增量)
  python cli.py index /path/to/repos

  # 端到端搜索 + 分析
  python cli.py search --requirement "支持 PRIIPs 报表导出"
  python cli.py search --requirement-file requirement.txt

  # 只搜索不调 LLM(用于验证索引质量)
  python cli.py search --keywords PRIIPS KID CostCalculator --no-llm

环境变量:
  LLM_PROVIDER          anthropic | openai (默认 anthropic)
  ANTHROPIC_API_KEY     Anthropic API key
  OPENAI_API_KEY        OpenAI API key
  LLM_MODEL             主模型(默认 claude-sonnet-4-5-20250929)
  LLM_FALLBACK_MODEL    兜底模型(默认 gpt-4o-mini)
  LLM_BASE_URL          自定义 endpoint(可选)
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# 添加项目根到 sys.path(支持直接运行 cli.py)
PROJECT_ROOT = Path(__file__).parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from lib import scan, search, trace, build_context, verify, llm_call
from lib.schemas import (
    KeywordExpansionSchema,
    RepoSelectionSchema,
    ClueDecisionSchema,
    ImpactMap,
    JudgeResultSchema,
    UnknownsJudgeSchema,
)
from lib.scan import load_recipes

logger = logging.getLogger("cli")


# ============================================================
# 命令: index
# ============================================================
def cmd_index(args: argparse.Namespace) -> None:
    """Phase 0: 生成/更新索引"""
    recipes = load_recipes(args.recipes)
    scan.update_index(args.repos_root, recipes, args.index_dir)


# ============================================================
# 命令: search
# ============================================================
def cmd_search(args: argparse.Namespace) -> None:
    """Phase 1-3: 端到端搜索 + 分析"""

    # 加载需求(位置参数优先,其次 --requirement-file)
    requirement = args.requirement
    if args.requirement_file:
        requirement = Path(args.requirement_file).read_text(encoding="utf-8")
    hint = args.hint

    # 加载索引
    recipes = load_recipes(args.recipes)
    index_dir = args.index_dir

    # 检查索引是否存在
    cap_file = index_dir / "capabilities.jsonl"
    if not cap_file.exists():
        logger.error(f"索引不存在: {cap_file},请先运行: python cli.py index <repos_root>")
        sys.exit(1)

    # === Phase 1a: 关键词扩展(lite 模型) ===
    if args.keywords:
        keywords = args.keywords
        logger.info(f"[1/8] 使用手动关键词: {keywords}")
    elif args.no_llm:
        keywords = _auto_extract_keywords(requirement)
        if hint:
            keywords.extend(_auto_extract_keywords(hint))
        logger.info(f"[1/8] 自动提取关键词(--no-llm): {keywords}")
        if not keywords:
            logger.error("无法从需求文本提取关键词,请用 --keywords 手动指定")
            sys.exit(1)
    else:
        logger.info("[1/8] LLM 关键词扩展(lite)...")
        expand_prompt = _build_expand_prompt(requirement, hint)
        result = llm_call.llm_lite_call(expand_prompt, KeywordExpansionSchema)
        keywords = result.business + result.technical + result.infra + result.naming
        if not keywords:
            logger.error("LLM 关键词扩展返回空,请检查需求文本或手动传 --keywords")
            sys.exit(1)
        logger.info(f"  扩展结果: business={result.business}")
        logger.info(f"            technical={result.technical}")
        logger.info(f"            infra={result.infra}")
        logger.info(f"            naming={result.naming}")

    # === Phase 1b: Repo 筛选(lite 模型) ===
    if args.repos:
        target_repos = args.repos
        logger.info(f"[2/8] 使用手动 repo 列表: {target_repos}")
    elif args.no_llm:
        target_repos = _list_all_repos(index_dir)
        logger.info(f"[2/8] 无 LLM 模式,搜索所有 {len(target_repos)} 个 repo")
    else:
        logger.info("[2/8] LLM Repo 筛选(lite)...")
        repos_jsonl = (index_dir / "repos.jsonl").read_text(encoding="utf-8") if (index_dir / "repos.jsonl").exists() else ""
        if not repos_jsonl:
            logger.warning("repos.jsonl 不存在,搜索所有 repo")
            target_repos = _list_all_repos(index_dir)
        else:
            repo_prompt = _build_repo_filter_prompt(keywords, repos_jsonl, hint)
            repo_result = llm_call.llm_lite_call(repo_prompt, RepoSelectionSchema)
            target_repos = [s.repo for s in repo_result.selected]
            if not target_repos:
                logger.warning("LLM repo 筛选返回空,搜索所有 repo")
                target_repos = _list_all_repos(index_dir)
            else:
                logger.info(f"  选定 repo: {target_repos}")

    # === Phase 1c: 搜索 + 打分 ===
    logger.info(f"[3/8] rg 搜索 + 打分 (keywords={len(keywords)}, repos={len(target_repos)})...")
    repos_root = Path(args.repos_root) if args.repos_root else None
    top_files = search.search_and_rank(
        target_repos, keywords, index_dir, repos_root,
        top_k=args.top_k, hint=hint,
    )

    if not top_files:
        logger.error("搜索无结果")
        _print_no_result_hint(keywords, target_repos)
        sys.exit(1)

    # === Phase 1.5: LLM judge 过滤误命中(lite 模型) ===
    if not args.no_llm and len(top_files) > 3:
        logger.info("[4/8] LLM judge 过滤误命中(lite)...")
        top_files = _judge_and_filter(top_files, requirement, hint)
        logger.info(f"  judge 后保留 {len(top_files)} 个文件")

    print(f"\n{'='*60}")
    print(f"Top {len(top_files)} Files (打分排序)")
    print(f"{'='*60}")
    for i, sf in enumerate(top_files, 1):
        print(f"\n[{i}] score={sf.score}  {sf.file}")
        print(f"    breakdown: {sf.breakdown}")
        if sf.tags:
            print(f"    tags: {sf.tags[:5]}")

    # 如果 --no-llm,到这里结束
    if args.no_llm:
        print(f"\n{'='*60}")
        print("--no-llm 模式结束。要把 Top 文件交给 LLM 分析,去掉 --no-llm")
        return

    # === Phase 2: 线索追踪(最多 2 轮,lite 模型筛选) ===
    logger.info("[5/8] 线索追踪(lite 筛选)...")
    searched_terms = set(keywords)
    for round_n in range(2):
        new_clues = trace.extract_clues(top_files, recipes)
        new_clues = trace.filter_new_clues(new_clues, searched_terms)
        if not new_clues:
            logger.info(f"  第 {round_n+1} 轮: 无新线索,停止追踪")
            break

        clue_decision = llm_call.llm_lite_call(
            trace.build_clue_prompt(new_clues, requirement),
            ClueDecisionSchema,
        )
        if not clue_decision.priority_clues:
            logger.info(f"  第 {round_n+1} 轮: LLM 判定无需追踪")
            break

        logger.info(f"  第 {round_n+1} 轮: 追踪 {len(clue_decision.priority_clues)} 个线索")
        additional_files = search.search_and_rank(
            target_repos, clue_decision.priority_clues,
            index_dir, repos_root, top_k=10, hint=hint,
        )
        existing_files = {sf.file for sf in top_files}
        for sf in additional_files:
            if sf.file not in existing_files:
                top_files.append(sf)
                existing_files.add(sf.file)
        searched_terms.update(clue_decision.priority_clues)

    # === Phase 3a: Context 拼装 ===
    logger.info("[6/8] Context 拼装 + LLM 分析...")
    context = build_context.build(top_files, index_dir, requirement)

    # === Phase 3b: LLM 生成 Impact Map ===
    # --lite 模式用 lite 模型,默认用主模型(复杂推理留给主模型)
    if args.lite:
        logger.info("[7/8] LLM 生成 Impact Map(lite 模式)...")
        impact_map = llm_call.llm_lite_call(
            _build_impact_prompt(requirement, context, hint),
            ImpactMap, max_retry=3,
        )
    else:
        logger.info("[7/8] LLM 生成 Impact Map(主模型)...")
        impact_map = llm_call.llm_call(
            _build_impact_prompt(requirement, context, hint),
            ImpactMap, max_retry=3,
        )
    impact_map.requirement = requirement
    impact_map.generated_at = datetime.now(timezone.utc).isoformat()

    # === Phase 3c: 验证回路 ===
    verified = verify.verify_impact_map(impact_map, index_dir)

    # === Phase 3.5: LLM judge unknowns(lite 模型) ===
    if verified.unknowns:
        logger.info("[8/8] LLM judge unknowns(lite)...")
        verified = _judge_unknowns(verified, requirement)

    # === 输出最终交付 ===
    print(f"\n{'='*60}")
    print("Impact Map (验证后)")
    print(f"{'='*60}")
    print(f"confidence: {verified.confidence}")
    print(f"entry_points: {len(verified.entry_points)}")
    print(f"core_changes: {len(verified.core_changes)}")
    print(f"extension_points: {len(verified.extension_points)}")
    print(f"downstream_impacts: {len(verified.downstream_impacts)}")
    print(f"risks: {len(verified.risks)}")
    print(f"unknowns: {len(verified.unknowns)}")

    if verified.unknowns:
        print(f"\n--- Unknowns (需人工确认) ---")
        for u in verified.unknowns:
            print(f"  Q: {u.question}")
            print(f"  → 问: {u.who_to_ask}")

    output_path = Path(f"impact-map-{int(time.time())}.json")
    output_path.write_text(
        verified.model_dump_json(indent=2), encoding="utf-8"
    )
    print(f"\n最终交付已保存: {output_path}")


# ============================================================
# Prompt 构造
# ============================================================
def _build_expand_prompt(requirement: str, hint: str | None = None) -> str:
    hint_section = f"\n额外提示(优先考虑):\n{hint}\n" if hint else ""
    return f"""你是资深架构师。把以下业务需求展开为四类搜索关键词,用于在内部代码库中用 ripgrep 搜索。

需求:
{requirement}
{hint_section}
输出四类关键词:
1. business: 业务名词(如 Report, Statement, Document)
2. technical: 类名/方法名/技术词(如 PdfExporter, ReportBuilder, CostCalculator)
3. infra: Kafka topic / DB 表名 / S3 bucket / 配置 key
4. naming: 命名模式(支持 * 通配,如 generate*, build*, create*)

输出 JSON:
{{
  "business": ["..."],
  "technical": ["..."],
  "infra": ["..."],
  "naming": ["..."]
}}
"""


def _build_repo_filter_prompt(
    keywords: list[str], repos_jsonl: str, hint: str | None = None
) -> str:
    hint_section = f"\n额外提示:\n{hint}\n" if hint else ""
    return f"""你是资深架构师。基于以下搜索关键词:

{keywords}
{hint_section}
从这些 repo 档案中选出最可能涉及该需求的 Top 5 repo。

Repo 档案(JSONL):
{repos_jsonl}

输出 JSON:
{{
  "selected": [
    {{"repo": "repo-name", "reason": "为什么选这个 repo,一句话"}}
  ]
}}
"""


def _build_impact_prompt(
    requirement: str, context: str, hint: str | None = None
) -> str:
    schema_hint = json.dumps(
        ImpactMap.model_json_schema(), ensure_ascii=False, indent=2
    )
    hint_section = f"\n## 额外提示\n\n{hint}\n" if hint else ""
    return f"""你是资深系统架构师。基于以下 context,分析需求落地的影响。

## 需求

{requirement}
{hint_section}
## Context

{context}

## 任务

输出 Impact Map,严格按以下 JSON Schema:

{schema_hint}

要求:
- entry_points: 这个需求最可能的接入位置(API / Kafka 消费者 / 调度器)
- core_changes: 必须修改的文件 + 改动类型(新增/扩展/重构)
- extension_points: 已存在的 Feature Flag / 策略模式 / 插件机制(能不改就不改)
- downstream_impacts: 改了之后会被波及的调用方(Kafka 消费者、下游服务、前端)
- risks: 同名字段冲突、硬编码业务规则、测试覆盖盲区
- unknowns: 你不确定的问题(必须是具体问题,不是"需要进一步确认")
- confidence: 你对这次分析的置信度

只输出 JSON,不要包含其他文本。
"""


def _judge_and_filter(
    top_files: list, requirement: str, hint: str | None = None
) -> list:
    """Phase 1.5: 用 lite 模型判断 Top 文件是否真的跟需求相关,过滤误命中。

    rg 打分只看关键词命中,不判断语义相关性。
    比如"Report"可能命中 ReportConfig(配置)、ReportGenerator(业务)、ReportTest(测试)。
    lite 模型能区分这些,把不相关的砍掉。
    """
    from lib.schemas import ScoredFile

    # 构造文件摘要(只给 LLM 看摘要,不给全文,省 token)
    file_summaries = []
    for i, sf in enumerate(top_files):
        tags_str = ", ".join(sf.tags[:5]) if sf.tags else "无"
        hits_str = "; ".join(h.matched_text[:60] for h in sf.hits[:3])
        file_summaries.append(
            f"{i+1}. {sf.file}\n   tags: {tags_str}\n   hits: {hits_str}"
        )

    hint_section = f"\n额外提示: {hint}\n" if hint else ""
    prompt = f"""你是资深架构师。判断以下文件是否真的跟需求相关。

需求: {requirement}
{hint_section}
候选文件(rg 搜索 + 打分排序后):
{chr(10).join(file_summaries)}

对每个文件判断:
- relevant: 是否真的跟需求相关(rg 可能命中了同名词但语义无关)
- relevance_score: 相关性 0-100
- reason: 一句话理由

只保留 relevant=true 的文件。输出 JSON:
{{
  "judgments": [
    {{"file": "完整文件路径", "relevant": true, "relevance_score": 85, "reason": "..."}}
  ]
}}
"""
    result = llm_call.llm_lite_call(prompt, JudgeResultSchema)

    # 用 judge 结果过滤
    relevant_files = {j.file for j in result.judgments if j.relevant}
    filtered = [sf for sf in top_files if sf.file in relevant_files]

    # 如果 judge 把所有文件都砍了(不太可能但兜底),保留原始 Top 5
    if not filtered:
        logger.warning("judge 过滤后无文件,保留原始 Top 5")
        return top_files[:5]

    return filtered


def _judge_unknowns(impact_map, requirement: str):
    """Phase 3.5: 用 lite 模型判断 unknowns 哪些可以通过再搜一次解决。

    LLM 生成的 unknowns 里,有些是"搜一下就能回答"的(如"有没有其他 Kafka 消费者"),
    有些是"真的需要问人"的(如"这个业务规则为什么这样设计")。
    lite 模型能区分,把可自动解决的标记出来。
    """
    unknown_lines = [f"{i+1}. {u.question}" for i, u in enumerate(impact_map.unknowns)]

    prompt = f"""你是资深架构师。判断以下 unknown 问题是否可以通过再搜索代码自动解决。

需求: {requirement}

Unknowns:
{chr(10).join(unknown_lines)}

对每个问题判断:
- can_auto_resolve: 是否可以通过 rg/搜索代码自动回答
- suggested_search: 如果可以,建议搜什么关键词
- reason: 为什么

示例:
- "有没有其他服务消费 TradeCreated topic" → can_auto_resolve=true, suggested_search="TradeCreated"
- "为什么 2023 年把报表从 PDF 改成 Excel" → can_auto_resolve=false(需要问人)

输出 JSON:
{{
  "judgments": [
    {{"question": "原问题", "can_auto_resolve": true, "suggested_search": "...", "reason": "..."}}
  ]
}}
"""
    result = llm_call.llm_lite_call(prompt, UnknownsJudgeSchema)

    # 在 Impact Map 里标记可自动解决的 unknowns
    for judgment in result.judgments:
        for u in impact_map.unknowns:
            if u.question == judgment.question and judgment.can_auto_resolve:
                u.who_to_ask = f"可自动解决(建议搜: {judgment.suggested_search})"
                break

    return impact_map


def _auto_extract_keywords(text: str) -> list[str]:
    """从需求文本自动提取关键词(--no-llm 模式用,无需 LLM)"""
    import re

    # 停用词
    stop_words = {
        "支持", "实现", "需要", "一个", "这个", "那个", "的", "了", "在",
        "是", "我", "有", "和", "与", "或", "但", "如果", "因为", "所以",
        "给", "让", "做", "要", "会", "能", "可以", "应该", "以及", "进行",
        "the", "a", "an", "is", "are", "was", "were", "to", "for", "with",
        "and", "or", "but", "if", "then", "this", "that", "from", "in",
    }

    # 英文/数字词
    en_words = re.findall(r'[A-Za-z][A-Za-z0-9_]+', text)
    # 骆驼式拆分: PdfExporter -> Pdf, Exporter
    split_words = []
    for w in en_words:
        parts = re.findall(r'[A-Z][a-z]+|[A-Z]+(?=[A-Z])|[a-z]+', w)
        if len(parts) > 1:
            split_words.extend(parts)
        split_words.append(w)

    # 中文词(简单二字/三字提取)
    cn_words = re.findall(r'[\u4e00-\u9fa5]{2,4}', text)

    keywords = []
    for w in split_words + cn_words:
        if w.lower() not in stop_words and len(w) > 1:
            keywords.append(w)

    # 去重保序
    seen = set()
    result = []
    for w in keywords:
        if w.lower() not in seen and w not in seen:
            seen.add(w.lower())
            result.append(w)

    # 加通配符版本(英文词)
    for w in en_words:
        if len(w) > 4:
            result.append(f"{w[:4]}*")

    return result


# ============================================================
# 辅助函数
# ============================================================
def _list_all_repos(index_dir: Path) -> list[str]:
    """从 repos.jsonl 读取所有 repo 名"""
    path = index_dir / "repos.jsonl"
    if not path.exists():
        return []
    repos = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    repos.append(json.loads(line)["repo"])
                except (json.JSONDecodeError, KeyError):
                    continue
    return repos


def _print_no_result_hint(keywords: list[str], repos: list[str]) -> None:
    """搜索无结果时的提示"""
    print(f"\n{'='*60}")
    print("搜索无结果。可能原因:")
    print(f"{'='*60}")
    print(f"1. 关键词太精确: {keywords}")
    print(f"   → 尝试用更宽泛的词,或用 * 通配符(如 Report*)")
    print(f"2. repo 不对: {repos}")
    print(f"   → 检查 repos.jsonl 是否覆盖了所有 repo")
    print(f"3. 配方表没覆盖目标语言")
    print(f"   → 检查 recipes.yaml 是否有目标框架的配方")
    print(f"4. 业务词和代码词不在同一语义空间")
    print(f"   → 让 LLM 用'反向搜索':假设自己实现这个需求,会建什么类/表/接口")


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


# ============================================================
# CLI 入口
# ============================================================
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Solution Architect 代码搜索工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="详细日志")
    parser.add_argument(
        "--recipes", default="recipes.yaml", help="配方表路径(默认 recipes.yaml)"
    )
    parser.add_argument(
        "--index-dir", default="index", type=Path, help="索引目录(默认 index)"
    )

    sub = parser.add_subparsers(dest="cmd", required=True)

    # === index 命令 ===
    p_index = sub.add_parser("index", help="生成/更新索引")
    p_index.add_argument("repos_root", type=Path, help="repo 根目录")
    p_index.add_argument(
        "--full", action="store_true", help="强制全量重建(忽略增量)"
    )

    # === search 命令 ===
    p_search = sub.add_parser("search", help="端到端搜索 + 分析")
    p_search.add_argument(
        "requirement", nargs="?", default="",
        help="需求文本(直接传,不用 --requirement)",
    )
    p_search.add_argument(
        "--hint", default=None,
        help="额外提示,如 '重点关注 Kafka 消费者' 或 '只看 Java 代码'",
    )
    p_search.add_argument("--requirement-file", type=Path, help="需求文件路径")
    p_search.add_argument(
        "--keywords", nargs="+", help="手动指定关键词(跳过 LLM 扩展)"
    )
    p_search.add_argument(
        "--repos", nargs="+", help="手动指定 repo 列表(跳过 LLM 筛选)"
    )
    p_search.add_argument(
        "--repos-root", type=Path,
        help="repo 根目录(默认从 index/config.json 自动读取)",
    )
    p_search.add_argument(
        "--top-k", type=int, default=20, help="返回 Top K 文件(默认 20)"
    )
    p_search.add_argument(
        "--no-llm", action="store_true",
        help="不调用 LLM,自动从需求文本提取关键词,只输出搜索结果",
    )
    p_search.add_argument(
        "--lite", action="store_true",
        help="全流程用 lite 模型(haiku/gpt-4o-mini),不调主模型,适合快速验证",
    )

    args = parser.parse_args()
    _setup_logging(args.verbose)

    if args.cmd == "index":
        cmd_index(args)
    elif args.cmd == "search":
        cmd_search(args)


if __name__ == "__main__":
    main()
