"""索引生成 - 全量 + 增量。

生成三种索引文件:
- capabilities.jsonl: 业务节点(API/Kafka/DB/...)
- business_flow.jsonl: 按 file 聚合的业务标签
- repos.jsonl: repo 档案
- sha_map.json: 增量基线
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel

from .schemas import Capability, BusinessFlow, RepoProfile

logger = logging.getLogger(__name__)

# 扫描时忽略的目录
IGNORE_DIRS = {
    ".git", "node_modules", "vendor", "dist", "build",
    "test", "tests", "__tests__", "mock", "mocks", "fixture",
    ".idea", ".vscode", "target", "bin", "obj",
}

# 扫描的文件扩展名
SCAN_EXTENSIONS = {
    ".java", ".kt", ".scala",
    ".py",
    ".js", ".jsx", ".ts", ".tsx",
    ".go",
    ".sql",
    ".proto", ".graphql",
    ".yaml", ".yml",  # 配置文件
}


# ============================================================
# 公开 API
# ============================================================
def load_recipes(recipes_path: str | Path) -> dict[str, Any]:
    """加载 recipes.yaml"""
    with open(recipes_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def hash_recipes(recipes: dict[str, Any]) -> str:
    """计算配方表指纹,用于判断配方是否变更"""
    content = json.dumps(recipes, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def update_index(
    repos_root: str | Path,
    recipes: dict[str, Any],
    index_dir: str | Path,
) -> None:
    """索引主入口:自动判断全量重建还是增量更新。

    Args:
        repos_root: 包含多个 repo 的根目录
        recipes: 从 recipes.yaml 加载的配方表
        index_dir: 索引输出目录
    """
    repos_root = Path(repos_root).resolve()
    index_dir = Path(index_dir)
    index_dir.mkdir(parents=True, exist_ok=True)

    # 保存 config.json(search.py 自动读,用户不需要传 --repos-root)
    _save_config(index_dir, repos_root)

    recipes_hash = hash_recipes(recipes)
    last_hash = _load_recipes_hash(index_dir)

    if recipes_hash != last_hash:
        logger.info(
            f"配方表变更 (旧={last_hash}, 新={recipes_hash}), 全量重建"
        )
        full_rebuild(repos_root, recipes, index_dir)
        _save_recipes_hash(index_dir, recipes_hash)
    else:
        logger.info("配方表未变更,执行增量更新")
        incremental_update(repos_root, recipes, index_dir)

    # 输出配方命中率报告(帮用户判断哪些配方有效)
    _print_recipe_report(index_dir, recipes)


def full_rebuild(
    repos_root: Path,
    recipes: dict[str, Any],
    index_dir: Path,
) -> None:
    """全量重建所有索引"""
    sha_map: dict[str, str] = {}
    all_caps: list[Capability] = []
    all_profiles: list[RepoProfile] = []

    repos = [d for d in repos_root.iterdir() if d.is_dir() and not d.name.startswith(".")]
    logger.info(f"全量扫描 {len(repos)} 个 repo")

    for repo_path in repos:
        logger.info(f"  扫描 {repo_path.name}...")
        commit_sha = _git_rev_parse(repo_path)
        sha_map[repo_path.name] = commit_sha

        # 扫描业务节点
        caps = scan_repo(repo_path, recipes)
        all_caps.extend(caps)

        # 生成 repo 档案
        profile = build_repo_profile(repo_path, commit_sha)
        all_profiles.append(profile)

    # 写入 capabilities.jsonl
    _write_jsonl(index_dir / "capabilities.jsonl", all_caps)

    # 聚合生成 business_flow.jsonl
    business_flows = _aggregate_business_flow(all_caps, repos_root)
    _write_jsonl(index_dir / "business_flow.jsonl", business_flows)

    # 写入 repos.jsonl
    _write_jsonl(index_dir / "repos.jsonl", all_profiles)

    # 写入 sha_map.json
    _save_sha_map(index_dir, sha_map)

    logger.info(
        f"全量重建完成: {len(all_caps)} 个业务节点, "
        f"{len(business_flows)} 个文件, {len(all_profiles)} 个 repo"
    )


def incremental_update(
    repos_root: Path,
    recipes: dict[str, Any],
    index_dir: Path,
) -> None:
    """增量更新:只重跑变更文件"""
    sha_map = _load_sha_map(index_dir)
    if not sha_map:
        logger.warning("无 sha_map,回退到全量重建")
        full_rebuild(repos_root, recipes, index_dir)
        return

    # 加载现有 capabilities
    caps_file = index_dir / "capabilities.jsonl"
    existing_caps: list[Capability] = []
    if caps_file.exists():
        with open(caps_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    existing_caps.append(Capability(**json.loads(line)))

    repos = [d for d in repos_root.iterdir() if d.is_dir() and not d.name.startswith(".")]
    total_changed = 0

    for repo_path in repos:
        current_sha = _git_rev_parse(repo_path)
        last_sha = sha_map.get(repo_path.name)

        if last_sha == current_sha:
            continue

        logger.info(f"  {repo_path.name} 有变更 ({last_sha[:7]} → {current_sha[:7]})")

        if last_sha is None:
            # 新 repo,全量扫描
            new_caps = scan_repo(repo_path, recipes)
        else:
            # 增量:拿变更文件
            changed_files = _git_diff_name_only(repo_path, last_sha, current_sha)
            new_caps = []
            for f in changed_files:
                file_path = repo_path / f
                if file_path.exists() and _should_scan(file_path):
                    new_caps.extend(
                        _run_recipes_on_file(recipes, repo_path.name, file_path)
                    )

        # 移除该 repo 的旧记录
        existing_caps = [c for c in existing_caps if c.repo != repo_path.name]
        existing_caps.extend(new_caps)
        sha_map[repo_path.name] = current_sha
        total_changed += len(new_caps)

    if total_changed == 0:
        logger.info("无变更,跳过更新")
        return

    # 重写 capabilities.jsonl
    _write_jsonl(caps_file, existing_caps)

    # 重新聚合 business_flow
    business_flows = _aggregate_business_flow(existing_caps, repos_root)
    _write_jsonl(index_dir / "business_flow.jsonl", business_flows)

    # 更新 sha_map
    _save_sha_map(index_dir, sha_map)

    logger.info(f"增量更新完成: {total_changed} 个新业务节点")


def scan_repo(
    repo_path: Path,
    recipes: dict[str, Any],
) -> list[Capability]:
    """扫描单个 repo,返回所有业务节点"""
    caps: list[Capability] = []
    commit_sha = _git_rev_parse(repo_path)
    indexed_at = datetime.now(timezone.utc).isoformat()

    for file_path in _iter_source_files(repo_path):
        caps.extend(
            _run_recipes_on_file(recipes, repo_path.name, file_path, commit_sha, indexed_at)
        )

    return caps


def build_repo_profile(repo_path: Path, commit_sha: str) -> RepoProfile:
    """构建 repo 档案"""
    # 读 README 前 50 行
    description = ""
    for readme_name in ["README.md", "README.MD", "readme.md", "README.rst"]:
        readme = repo_path / readme_name
        if readme.exists():
            lines = readme.read_text(encoding="utf-8", errors="ignore").splitlines()
            description = "\n".join(lines[:50])
            break

    # 检测语言
    languages = _detect_languages(repo_path)
    frameworks = _detect_frameworks(repo_path)

    # 检测 service 名
    service_name = _detect_service_name(repo_path)

    return RepoProfile(
        repo=repo_path.name,
        description=description,
        languages=languages,
        frameworks=frameworks,
        service_name=service_name,
        entry_points=[],
        commit_sha=commit_sha,
        indexed_at=datetime.now(timezone.utc).isoformat(),
    )


# ============================================================
# 内部实现
# ============================================================
def _run_recipes_on_file(
    recipes: dict[str, Any],
    repo_name: str,
    file_path: Path,
    commit_sha: str | None = None,
    indexed_at: str | None = None,
) -> list[Capability]:
    """对单个文件执行所有配方"""
    if commit_sha is None:
        commit_sha = _git_rev_parse(file_path.parent)
    if indexed_at is None:
        indexed_at = datetime.now(timezone.utc).isoformat()

    # 检查 glob 过滤
    rel_path = file_path
    try:
        text = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    caps: list[Capability] = []
    for recipe in recipes.get("recipes", []):
        # glob 过滤
        glob_pattern = recipe.get("glob")
        if glob_pattern:
            import fnmatch
            if not fnmatch.fnmatch(file_path.name, glob_pattern):
                continue

        pattern = recipe.get("pattern", "")
        try:
            regex = re.compile(pattern, re.MULTILINE)
        except re.error as e:
            logger.warning(f"配方 {recipe.get('name')} 正则错误: {e}")
            continue

        for match in regex.finditer(text):
            # 取最后一个捕获组作为 value
            value = match.group(match.lastindex or 0) if match.groups() else match.group(0)
            line_num = text[: match.start()].count("\n") + 1

            caps.append(Capability(
                repo=repo_name,
                file=str(file_path),
                line=line_num,
                type=recipe.get("type", "unknown"),
                value=value,
                flow=recipe.get("flow", "bidirectional"),
                recipe=recipe.get("name", "unknown"),
                indexed_at=indexed_at,
                commit_sha=commit_sha,
            ))

    return caps


def _aggregate_business_flow(
    caps: list[Capability],
    repos_root: Path,
) -> list[BusinessFlow]:
    """把 capabilities 按 file 聚合成 business_flow"""
    from collections import defaultdict

    file_caps: dict[str, list[Capability]] = defaultdict(list)
    for cap in caps:
        file_caps[cap.file].append(cap)

    flows: list[BusinessFlow] = []
    for file_path, file_caps_list in file_caps.items():
        # tags 不去重、不排序,保留文件内出现顺序
        tags = [
            f"{c.type}:{c.value}"
            for c in sorted(file_caps_list, key=lambda x: x.line)
        ]
        has_inbound = any(c.flow in ("in", "bidirectional") for c in file_caps_list)
        has_outbound = any(c.flow in ("out", "bidirectional") for c in file_caps_list)

        # 统计文件行数
        line_count = 0
        try:
            line_count = sum(1 for _ in open(file_path, encoding="utf-8", errors="ignore"))
        except Exception:
            pass

        repo_name = file_caps_list[0].repo if file_caps_list else ""
        flows.append(BusinessFlow(
            repo=repo_name,
            file=file_path,
            tags=tags,
            has_inbound=has_inbound,
            has_outbound=has_outbound,
            line_count=line_count,
        ))

    return flows


def _iter_source_files(repo_path: Path):
    """遍历 repo 中的源代码文件"""
    for file_path in repo_path.rglob("*"):
        if not file_path.is_file():
            continue
        if not _should_scan(file_path):
            continue
        yield file_path


def _should_scan(file_path: Path) -> bool:
    """判断文件是否应该扫描"""
    # 检查忽略目录
    parts = file_path.parts
    for ignore in IGNORE_DIRS:
        if ignore in parts:
            return False

    # 检查扩展名
    if file_path.suffix not in SCAN_EXTENSIONS:
        return False

    return True


def _detect_languages(repo_path: Path) -> list[str]:
    """检测 repo 主要语言"""
    lang_map = {
        ".java": "java", ".kt": "kotlin",
        ".py": "python",
        ".js": "javascript", ".jsx": "javascript",
        ".ts": "typescript", ".tsx": "typescript",
        ".go": "go",
        ".rs": "rust",
        ".cs": "csharp",
    }
    found: set[str] = set()
    for f in repo_path.rglob("*"):
        if f.is_file() and f.suffix in lang_map:
            found.add(lang_map[f.suffix])
            if len(found) >= 3:
                break
    return list(found)


def _detect_frameworks(repo_path: Path) -> list[str]:
    """检测框架"""
    frameworks: list[str] = []

    # Spring Boot (pom.xml / build.gradle)
    if (repo_path / "pom.xml").exists():
        frameworks.append("maven")
    if (repo_path / "build.gradle").exists() or (repo_path / "build.gradle.kts").exists():
        frameworks.append("gradle")

    # Node.js
    pkg = repo_path / "package.json"
    if pkg.exists():
        try:
            pkg_data = json.loads(pkg.read_text(encoding="utf-8"))
            deps = {**pkg_data.get("dependencies", {}), **pkg_data.get("devDependencies", {})}
            if "express" in deps:
                frameworks.append("express")
            if "nestjs" in deps or "@nestjs/core" in deps:
                frameworks.append("nestjs")
            if "fastapi" in deps:
                frameworks.append("fastapi")
        except Exception:
            pass

    # Go
    if (repo_path / "go.mod").exists():
        frameworks.append("go-module")

    # Python
    reqs = repo_path / "requirements.txt"
    if reqs.exists():
        try:
            content = reqs.read_text(encoding="utf-8").lower()
            if "fastapi" in content:
                frameworks.append("fastapi")
            if "flask" in content:
                frameworks.append("flask")
            if "django" in content:
                frameworks.append("django")
        except Exception:
            pass

    return frameworks


def _detect_service_name(repo_path: Path) -> str:
    """从 CI/k8s 配置抠 service 名"""
    # Dockerfile
    dockerfile = repo_path / "Dockerfile"
    if dockerfile.exists():
        return repo_path.name  # 简化:用 repo 名

    # k8s manifest
    for k8s_dir in ["k8s", "deploy", "deployment", ".k8s"]:
        k8s_path = repo_path / k8s_dir
        if k8s_path.exists():
            return repo_path.name

    return repo_path.name


# ============================================================
# Git 工具函数
# ============================================================
def _git_rev_parse(repo_path: Path) -> str:
    """获取 repo 的 HEAD commit sha"""
    try:
        result = subprocess.run(
            ["git", "-C", str(repo_path), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def _git_diff_name_only(repo_path: Path, old_sha: str, new_sha: str) -> list[str]:
    """获取两个 commit 之间变更的文件列表"""
    try:
        result = subprocess.run(
            [
                "git", "-C", str(repo_path),
                "diff", "--name-only", old_sha, new_sha,
            ],
            capture_output=True, text=True, check=True,
        )
        return [f for f in result.stdout.strip().splitlines() if f]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return []


# ============================================================
# 索引文件读写
# ============================================================
def _write_jsonl(path: Path, items: list[Any]) -> None:
    """写入 jsonl 文件"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for item in items:
            if isinstance(item, BaseModel):
                f.write(item.model_dump_json(ensure_ascii=False) + "\n")
            else:
                f.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")


def _load_sha_map(index_dir: Path) -> dict[str, str]:
    """加载 sha_map.json"""
    path = index_dir / "sha_map.json"
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_sha_map(index_dir: Path, sha_map: dict[str, str]) -> None:
    """保存 sha_map.json"""
    path = index_dir / "sha_map.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(sha_map, f, indent=2, ensure_ascii=False)


def _load_recipes_hash(index_dir: Path) -> str:
    """加载上次索引时的配方表指纹"""
    path = index_dir / "recipes_hash.txt"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()


def _save_recipes_hash(index_dir: Path, hash_value: str) -> None:
    """保存配方表指纹"""
    path = index_dir / "recipes_hash.txt"
    path.write_text(hash_value, encoding="utf-8")


def _save_config(index_dir: Path, repos_root: Path) -> None:
    """保存索引配置(search.py 自动读,用户不需要传 --repos-root)"""
    config = {
        "repos_root": str(repos_root),
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }
    path = index_dir / "config.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def load_config(index_dir: Path) -> dict[str, Any]:
    """读取索引配置"""
    path = index_dir / "config.json"
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _print_recipe_report(index_dir: Path, recipes: dict[str, Any]) -> None:
    """输出配方命中率报告,帮用户判断哪些配方有效/可删"""
    cap_path = index_dir / "capabilities.jsonl"
    if not cap_path.exists():
        return

    # 统计每个配方的命中数
    recipe_hits: dict[str, int] = {}
    total_repos: set[str] = set()
    with open(cap_path, "r", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                cap = json.loads(line)
                recipe_name = cap.get("recipe", "unknown")
                recipe_hits[recipe_name] = recipe_hits.get(recipe_name, 0) + 1
                total_repos.add(cap.get("repo", ""))
            except json.JSONDecodeError:
                continue

    if not recipe_hits:
        return

    all_recipe_names = [r.get("name", "?") for r in recipes.get("recipes", [])]
    print(f"\n{'='*60}")
    print(f"配方命中率报告 ({len(total_repos)} 个 repo)")
    print(f"{'='*60}")

    # 按命中数降序
    sorted_recipes = sorted(
        recipe_hits.items(), key=lambda x: x[1], reverse=True
    )
    for name, count in sorted_recipes:
        print(f"  {name:30s}  {count:4d} 命中")

    # 找出零命中配方
    zero_recipes = [
        n for n in all_recipe_names if n not in recipe_hits
    ]
    if zero_recipes:
        print(f"\n零命中配方(可考虑删除):")
        for name in zero_recipes:
            print(f"  {name}")
    print()
