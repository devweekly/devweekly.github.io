"""Pydantic schemas - 所有 LLM 输出的结构化契约。

每个 schema 都用于 llm_call() 的输出校验,LLM 必须返回符合 schema 的 JSON,
否则触发 retry,最终触发 fallback。
"""
from __future__ import annotations

from typing import Literal, Optional
from pydantic import BaseModel, Field


# ============================================================
# Phase 1: 关键词扩展
# ============================================================
class KeywordExpansionSchema(BaseModel):
    """LLM 关键词扩展输出"""
    business: list[str] = Field(default_factory=list, description="业务名词")
    technical: list[str] = Field(default_factory=list, description="类名/方法名/技术词")
    infra: list[str] = Field(default_factory=list, description="Kafka topic / DB 表 / S3 等")
    naming: list[str] = Field(default_factory=list, description="命名模式,支持 * 通配")
    fallback_used: bool = Field(default=False, description="是否使用了 fallback")
    error: Optional[str] = Field(default=None, description="fallback 时的错误信息")


# ============================================================
# Phase 1: Repo 筛选
# ============================================================
class RepoSelection(BaseModel):
    repo: str
    reason: str = Field(description="为什么选这个 repo,一句话")


class RepoSelectionSchema(BaseModel):
    """LLM repo 筛选输出"""
    selected: list[RepoSelection] = Field(default_factory=list)
    fallback_used: bool = False
    error: Optional[str] = None


# ============================================================
# Phase 2: 线索筛选
# ============================================================
class ClueDecisionSchema(BaseModel):
    """LLM 线索筛选输出"""
    priority_clues: list[str] = Field(
        default_factory=list,
        description="值得第二轮搜索的线索词"
    )
    skip_clues: list[str] = Field(
        default_factory=list,
        description="不值得追踪的线索词"
    )
    reason: str = Field(default="", description="筛选理由")


# ============================================================
# Phase 3: Impact Map (最终交付物)
# ============================================================
class EntryPoint(BaseModel):
    type: Literal["api", "kafka_consumer", "scheduler", "manual"] = "api"
    location: str = Field(description="file:line")
    reason: str


class CoreChange(BaseModel):
    file: str
    change_type: Literal["new", "extend", "refactor"] = "extend"
    description: str
    rationale: str
    confidence: Literal["high", "medium", "low"] = "medium"
    git_history: list[str] = Field(default_factory=list, description="verify.py 填充")


class ExtensionPoint(BaseModel):
    type: Literal["feature_flag", "strategy_pattern", "plugin", "config"] = "config"
    location: str
    how_to_use: str


class DownstreamImpact(BaseModel):
    target: str = Field(description="service / topic / table 名")
    impact_type: Literal["breaking", "additive", "none"] = "additive"
    affected_repos: list[str] = Field(default_factory=list)
    verification_note: Optional[str] = None


class Risk(BaseModel):
    severity: Literal["high", "medium", "low"] = "medium"
    description: str
    mitigation: str


class Unknown(BaseModel):
    question: str = Field(description="必须是具体问题,不能是'需要进一步确认'")
    who_to_ask: str = Field(description="角色或团队")


class ImpactMap(BaseModel):
    """最终交付物 - Impact Map"""
    requirement: str
    generated_at: str
    entry_points: list[EntryPoint] = Field(default_factory=list)
    core_changes: list[CoreChange] = Field(default_factory=list)
    extension_points: list[ExtensionPoint] = Field(default_factory=list)
    downstream_impacts: list[DownstreamImpact] = Field(default_factory=list)
    risks: list[Risk] = Field(default_factory=list)
    unknowns: list[Unknown] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "medium"


# ============================================================
# 内部数据结构(非 LLM 输出,用于管道内部传递)
# ============================================================
class Capability(BaseModel):
    """capabilities.jsonl 的一行"""
    repo: str
    file: str
    line: int
    type: str
    value: str
    flow: Literal["in", "out", "bidirectional"]
    recipe: str
    indexed_at: str
    commit_sha: str


class BusinessFlow(BaseModel):
    """business_flow.jsonl 的一行"""
    repo: str
    file: str
    tags: list[str] = Field(default_factory=list)
    has_inbound: bool = False
    has_outbound: bool = False
    line_count: int = 0


class RepoProfile(BaseModel):
    """repos.jsonl 的一行"""
    repo: str
    description: str = ""
    languages: list[str] = Field(default_factory=list)
    frameworks: list[str] = Field(default_factory=list)
    service_name: str = ""
    entry_points: list[str] = Field(default_factory=list)
    commit_sha: str = ""
    indexed_at: str = ""


class SearchHit(BaseModel):
    """rg 搜索命中"""
    file: str
    line: int
    keyword: str
    matched_text: str
    in_class_name: bool = False
    in_method_name: bool = False
    in_comment: bool = False


class ScoredFile(BaseModel):
    """打分后的文件"""
    file: str
    repo: str
    score: int
    breakdown: dict[str, int]
    tags: list[str] = Field(default_factory=list)
    hits: list[SearchHit] = Field(default_factory=list)


class Clue(BaseModel):
    """从 Top 文件提取的下游线索"""
    flow: Literal["in", "out", "bidirectional"]
    type: str
    value: str
    source_file: str


# ============================================================
# LLM as Judge schemas (用 lite 模型)
# ============================================================
class FileRelevanceJudge(BaseModel):
    """LLM judge: 判断单个文件是否真的跟需求相关"""
    file: str
    relevant: bool = Field(description="是否真的跟需求相关")
    relevance_score: int = Field(ge=0, le=100, description="相关性 0-100")
    reason: str = Field(description="一句话理由")


class JudgeResultSchema(BaseModel):
    """LLM judge 批量判断文件相关性"""
    judgments: list[FileRelevanceJudge] = Field(default_factory=list)


class UnknownJudge(BaseModel):
    """LLM judge: 判断 unknown 是否可以通过再搜一次解决"""
    question: str
    can_auto_resolve: bool = Field(description="是否可以通过再搜索自动解决")
    suggested_search: str = Field(default="", description="如果可以自动解决,建议搜什么")
    reason: str = Field(default="")


class UnknownsJudgeSchema(BaseModel):
    """LLM judge 批量判断 unknowns"""
    judgments: list[UnknownJudge] = Field(default_factory=list)
