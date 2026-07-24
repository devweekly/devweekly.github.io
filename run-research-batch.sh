#!/usr/bin/env bash
# Batch-run research-repo skill on all ref-only repos.
# Two batches of 4 repos each, parallel within a batch, sequential across batches.
set -u

DATE=20260724
SKILL=.trae/skills/research-repo/research-repo.mjs
REF=ref-only

REPOS=(
  Auto-Empirical-Research-Skills
  ResearchStudio
  code-review-graph
  openworker
  buzz
  custodian-kernel
  pi
  worldmonitor
)

run_one() {
  local repo="$1"
  local dir="research-${repo}-${DATE}"
  mkdir -p "$dir/evidence-store"
  cp "$SKILL" "$dir/research-repo.mjs"
  echo "[$(date +%H:%M:%S)] START $repo"
  ( cd "$dir" \
    && node research-repo.mjs all "../${REF}/${repo}" > evidence-store/full.json 2> analyze.err \
    && node research-repo.mjs report --lang=zh "../${REF}/${repo}" > evidence-brief.md 2>> analyze.err \
  )
  local rc=$?
  if [ $rc -eq 0 ]; then
    echo "[$(date +%H:%M:%S)] DONE  $repo (full.json $(wc -c < evidence-store/full.json 2>/dev/null) bytes, brief $(wc -c < evidence-brief.md 2>/dev/null) bytes)"
  else
    echo "[$(date +%H:%M:%S)] FAIL  $repo (rc=$rc, see $dir/analyze.err)"
  fi
}

# Batch 1: first 4 repos in parallel
echo "=== Batch 1: ${REPOS[0..3]} ==="
for repo in "${REPOS[@]:0:4}"; do
  run_one "$repo" &
done
wait

# Batch 2: next 4 repos in parallel
echo "=== Batch 2: ${REPOS[4..7]} ==="
for repo in "${REPOS[@]:4:4}"; do
  run_one "$repo" &
done
wait

echo "=== ALL DONE ==="
ls -d research-*-20260724 2>/dev/null | while read d; do
  echo "$d: full=$(test -f "$d/evidence-store/full.json" && echo OK || echo MISSING), brief=$(test -f "$d/evidence-brief.md" && echo OK || echo MISSING)"
done
