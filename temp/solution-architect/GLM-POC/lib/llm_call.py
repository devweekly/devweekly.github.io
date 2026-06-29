"""LLM 编排层 - 统一封装 schema 校验 + retry + fallback。

支持 anthropic 和 openai 两种 provider,通过环境变量切换:
- LLM_PROVIDER: anthropic | openai (默认 anthropic)
- ANTHROPIC_API_KEY / OPENAI_API_KEY
- LLM_MODEL: 主模型(默认 claude-sonnet-4-5-20250929),用于复杂推理(Impact Map)
- LLM_LITE_MODEL: lite 模型(默认 claude-haiku-4-5-20251001),用于简单判断(judge/筛选/扩展)
- LLM_FALLBACK_MODEL: 兜底模型(默认 gpt-4o-mini)
- LLM_BASE_URL: 可选,自定义 endpoint

分层使用:
- llm_call(): 主模型,留给 Impact Map 等复杂推理
- llm_lite_call(): lite 模型,用于关键词扩展/repo 筛选/线索筛选/judge
"""
from __future__ import annotations

import json
import os
import re
import logging
from typing import Type, TypeVar

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def _get_lite_model() -> str:
    """获取 lite 模型名"""
    return os.getenv("LLM_LITE_MODEL", "claude-haiku-4-5-20251001")


def _get_lite_provider() -> str:
    """lite 模型的 provider(根据模型名推断)"""
    model = _get_lite_model()
    if "gpt" in model.lower():
        return "openai"
    return os.getenv("LLM_PROVIDER", "anthropic").lower()


def llm_call(
    prompt: str,
    output_schema: Type[T],
    max_retry: int = 2,
    model: str | None = None,
    fallback_model: str | None = None,
    system_prompt: str = "You are a helpful assistant that outputs valid JSON.",
) -> T:
    """统一 LLM 调用封装:强制 schema 校验 + retry + fallback。

    用法:
        keywords = llm_call(prompt, KeywordExpansionSchema)
        # keywords 已经是 KeywordExpansionSchema 实例,类型安全

    Args:
        prompt: 用户 prompt
        output_schema: 期望输出的 Pydantic schema 类
        max_retry: 最大重试次数(不含 fallback)
        model: 主模型,默认从 LLM_MODEL 环境变量读取
        fallback_model: 兜底模型,默认从 LLM_FALLBACK_MODEL 读取
        system_prompt: 系统提示,默认要求输出 JSON

    Returns:
        output_schema 的实例

    Raises:
        RuntimeError: 所有 retry 和 fallback 都失败
    """
    provider = os.getenv("LLM_PROVIDER", "anthropic").lower()
    model = model or os.getenv("LLM_MODEL", "claude-sonnet-4-5-20250929")
    fallback_model = fallback_model or os.getenv(
        "LLM_FALLBACK_MODEL", "gpt-4o-mini"
    )

    schema_hint = (
        f"\n\n请严格输出符合以下 JSON Schema 的 JSON(不要包含其他文本):\n"
        f"{json.dumps(output_schema.model_json_schema(), ensure_ascii=False, indent=2)}"
    )
    full_prompt = prompt + schema_hint

    last_error: Exception | None = None
    current_prompt = full_prompt

    # === Phase 1: 主模型 retry ===
    for attempt in range(max_retry + 1):
        try:
            raw = _raw_llm_call(
                current_prompt, model, provider, system_prompt
            )
            parsed = _extract_json(raw)
            result = output_schema.model_validate(parsed)
            if attempt > 0:
                logger.info(f"LLM 在第 {attempt + 1} 次尝试后成功")
            return result
        except (ValidationError, json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning(
                f"LLM 调用失败 (attempt {attempt + 1}/{max_retry + 1}): {e}"
            )
            # 把错误信息塞回 prompt,让 LLM 自我修正
            current_prompt = (
                f"{full_prompt}\n\n"
                f"--- 上一次输出格式错误,请修正 ---\n"
                f"错误: {e}\n"
                f"请严格按 schema 输出合法 JSON,不要包含 markdown 代码块标记。"
            )

    # === Phase 2: fallback 模型 ===
    logger.warning(f"主模型失败,切换到 fallback: {fallback_model}")
    # fallback provider 跟着 fallback model 走
    fallback_provider = (
        "openai" if "gpt" in fallback_model.lower() else "anthropic"
    )
    try:
        raw = _raw_llm_call(
            full_prompt, fallback_model, fallback_provider, system_prompt
        )
        parsed = _extract_json(raw)
        return output_schema.model_validate(parsed)
    except (ValidationError, json.JSONDecodeError, ValueError) as e:
        last_error = e
        logger.error(f"Fallback 模型也失败: {e}")

    # === Phase 3: schema 特定的 fallback 策略 ===
    logger.warning("所有 LLM 调用失败,触发 fallback 策略")
    return _fallback_strategy(output_schema, last_error)


def _raw_llm_call(
    prompt: str, model: str, provider: str, system_prompt: str
) -> str:
    """调用底层 LLM SDK,返回原始文本"""
    if provider == "anthropic":
        return _call_anthropic(prompt, model, system_prompt)
    elif provider == "openai":
        return _call_openai(prompt, model, system_prompt)
    else:
        raise ValueError(f"Unknown provider: {provider}")


def _call_anthropic(prompt: str, model: str, system_prompt: str) -> str:
    """调用 Anthropic Claude"""
    try:
        import anthropic
    except ImportError as e:
        raise RuntimeError(
            "anthropic SDK 未安装,请运行: pip install anthropic"
        ) from e

    client = anthropic.Anthropic()  # 从 ANTHROPIC_API_KEY 环境变量读取
    base_url = os.getenv("LLM_BASE_URL")
    if base_url:
        client = anthropic.Anthropic(base_url=base_url)

    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": prompt}],
    )
    # 提取文本内容
    return response.content[0].text


def _call_openai(prompt: str, model: str, system_prompt: str) -> str:
    """调用 OpenAI / 兼容 API"""
    try:
        import openai
    except ImportError as e:
        raise RuntimeError(
            "openai SDK 未安装,请运行: pip install openai"
        ) from e

    kwargs = {}
    base_url = os.getenv("LLM_BASE_URL")
    if base_url:
        kwargs["base_url"] = base_url

    client = openai.OpenAI(**kwargs)
    response = client.chat.completions.create(
        model=model,
        max_tokens=4096,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content or ""


def _extract_json(raw: str) -> dict:
    """从 LLM 输出中提取 JSON,容错处理 markdown 代码块"""
    # 先尝试直接解析
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # 尝试剥离 markdown 代码块
    patterns = [
        r"```json\s*(.*?)\s*```",
        r"```\s*(.*?)\s*```",
    ]
    for pattern in patterns:
        match = re.search(pattern, raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(1))
            except json.JSONDecodeError:
                continue

    # 尝试找第一个 { 到最后一个 } 的内容
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start : end + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"无法从 LLM 输出中提取 JSON: {raw[:200]}...")


def _fallback_strategy(schema: Type[T], error: Exception | None) -> T:
    """所有 retry 失败后的兜底策略,每个 schema 有自己的 fallback"""
    from .schemas import (
        KeywordExpansionSchema,
        RepoSelectionSchema,
        ClueDecisionSchema,
        ImpactMap,
        Unknown,
    )

    err_msg = str(error) if error else "未知错误"

    if schema == KeywordExpansionSchema:
        # 关键词扩展失败:返回空列表,让 pipeline 用原始需求词搜
        logger.warning("关键词扩展 fallback: 返回空列表")
        return KeywordExpansionSchema(  # type: ignore
            business=[], technical=[], infra=[], naming=[],
            fallback_used=True, error=err_msg,
        )

    if schema == RepoSelectionSchema:
        # repo 筛选失败:返回空列表,cli 层会 fallback 到"搜所有 repo"
        logger.warning("repo 筛选 fallback: 返回空列表,将搜索所有 repo")
        return RepoSelectionSchema(  # type: ignore
            selected=[], fallback_used=True, error=err_msg,
        )

    if schema == ClueDecisionSchema:
        # 线索筛选失败:不追线索,直接进入 Impact Map
        logger.warning("线索筛选 fallback: 不追踪线索")
        return ClueDecisionSchema(  # type: ignore
            priority_clues=[], skip_clues=[], reason=f"fallback: {err_msg}",
        )

    if schema == ImpactMap:
        # Impact Map 失败:返回带 unknown 标记的空 map
        logger.warning("Impact Map fallback: 返回低置信度空 map")
        from datetime import datetime, timezone
        return ImpactMap(  # type: ignore
            requirement="",
            generated_at=datetime.now(timezone.utc).isoformat(),
            confidence="low",
            unknowns=[Unknown(
                question=f"LLM 分析失败,需人工介入。错误: {err_msg}",
                who_to_ask="architect",
            )],
        )

    raise RuntimeError(
        f"LLM 调用彻底失败,且 schema {schema.__name__} 无 fallback 策略: {err_msg}"
    )


def llm_lite_call(
    prompt: str,
    output_schema: Type[T],
    max_retry: int = 2,
    system_prompt: str = "You are a helpful assistant that outputs valid JSON.",
) -> T:
    """用 lite 模型(haiku/gpt-4o-mini)做简单判断。

    用于:关键词扩展、repo 筛选、线索筛选、文件相关性 judge、unknowns judge。
    成本约为主模型的 1/10,适合高频调用。

    跟 llm_call() 的区别:
    - 用 LLM_LITE_MODEL 而非 LLM_MODEL
    - fallback 也用 lite 模型(不升级到主模型)
    - 共享同一套 schema 校验 + retry 逻辑
    """
    lite_model = _get_lite_model()
    lite_provider = _get_lite_provider()

    schema_hint = (
        f"\n\n请严格输出符合以下 JSON Schema 的 JSON(不要包含其他文本):\n"
        f"{json.dumps(output_schema.model_json_schema(), ensure_ascii=False, indent=2)}"
    )
    full_prompt = prompt + schema_hint

    last_error: Exception | None = None
    current_prompt = full_prompt

    # Phase 1: lite 模型 retry
    for attempt in range(max_retry + 1):
        try:
            raw = _raw_llm_call(current_prompt, lite_model, lite_provider, system_prompt)
            parsed = _extract_json(raw)
            result = output_schema.model_validate(parsed)
            if attempt > 0:
                logger.info(f"lite 模型在第 {attempt + 1} 次尝试后成功")
            return result
        except (ValidationError, json.JSONDecodeError, ValueError) as e:
            last_error = e
            logger.warning(
                f"lite 模型调用失败 (attempt {attempt + 1}/{max_retry + 1}): {e}"
            )
            current_prompt = (
                f"{full_prompt}\n\n"
                f"--- 上一次输出格式错误,请修正 ---\n"
                f"错误: {e}\n"
                f"请严格按 schema 输出合法 JSON。"
            )

    # Phase 2: fallback 策略(复用 _fallback_strategy)
    logger.warning("lite 模型所有 retry 失败,触发 fallback 策略")
    return _fallback_strategy(output_schema, last_error)
