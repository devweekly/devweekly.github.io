#!/bin/bash
# 批量运行 research-repo skill 生成所有 ref-only repo 的 evidence-brief.md

set -e

REF_ONLY_DIR="/Users/saga/code-repos/devweekly.github.io/ref-only"
SKILL_DIR="/Users/saga/code-repos/devweekly.github.io/.trae/skills/research-repo"
WORK_DIR="/Users/saga/code-repos/devweekly.github.io"

# 获取所有 repo 名称
REPOS=$(ls -1 "$REF_ONLY_DIR" | grep -v '\.' || true)

echo "=========================================="
echo "批量运行 research-repo skill"
echo "=========================================="
echo ""

for repo in $REPOS; do
  echo "处理: $repo"
  echo "------------------------------------------"

  # 创建工作目录
  WORK_SUBDIR="$WORK_DIR/research-$repo-$(date +%Y%m%d)"
  mkdir -p "$WORK_SUBDIR"

  # 复制 research-repo.mjs 到工作目录
  cp "$SKILL_DIR/research-repo.mjs" "$WORK_SUBDIR/"

  # 运行分析
  cd "$WORK_SUBDIR"
  node research-repo.mjs all "$REF_ONLY_DIR/$repo" 2>&1 | tee analyze.log

  # 生成 evidence-brief.md
  node research-repo.mjs report --lang=zh "$REF_ONLY_DIR/$repo" > evidence-brief.md 2>> analyze.log

  echo "✓ $repo 完成: $WORK_SUBDIR"
  echo ""
done

echo "=========================================="
echo "所有 repo 处理完成"
echo "=========================================="
