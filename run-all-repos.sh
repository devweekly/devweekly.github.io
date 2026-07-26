#!/bin/bash
# Batch generate evidence-brief.md for all ref-only repos
# Usage: bash run-all-repos.sh

set -e

REPOS=(
  OfficeCLI ResearchStudio Vibe-Trading buzz code-review-graph
  custodian-kernel dbeaver litehybrid ng-zorro-antd open-design
  openworker page-agent pi pyod tensortrade topcoat unsloth worldmonitor
)

DATE=20260726
SKILL=.trae/skills/research-repo/research-repo.mjs

for repo in "${REPOS[@]}"; do
  OUT_DIR="research-${repo}-${DATE}"
  mkdir -p "$OUT_DIR"
  echo "=== Processing $repo ==="
  node "$SKILL" report "ref-only/$repo" --lang=zh > "$OUT_DIR/evidence-brief.md" 2> "$OUT_DIR/stderr.log" || {
    echo "FAILED: $repo (see $OUT_DIR/stderr.log)"
    continue
  }
  echo "OK: $repo -> $OUT_DIR/evidence-brief.md"
done

echo "=== All done ==="
