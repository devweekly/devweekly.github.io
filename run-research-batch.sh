#!/bin/bash
# Batch runner for research-repo skill on all ref-only repos.
# Runs in parallel batches to bound resource usage.
set -u

DATE="20260725"
REPOS=(
  Auto-Empirical-Research-Skills
  ResearchStudio
  buzz
  code-review-graph
  custodian-kernel
  dbeaver
  litehybrid
  ng-zorro-antd
  open-design
  openworker
  pi
  pyod
  topcoat
  worldmonitor
)

SKILL=".trae/skills/research-repo/research-repo.mjs"

run_one() {
  local repo="$1"
  local dir="research-${repo}-${DATE}"
  mkdir -p "${dir}/evidence-store"
  cp "${SKILL}" "${dir}/"
  (cd "${dir}" && \
    node research-repo.mjs all "../ref-only/${repo}" > evidence-store/full.json 2> analyze.err && \
    node research-repo.mjs report --lang=zh "../ref-only/${repo}" > evidence-brief.md 2>> analyze.err && \
    echo "OK ${repo}") || echo "FAIL ${repo} (see ${dir}/analyze.err)"
}

# Batch 1: first 5 repos
echo "=== Batch 1: ${REPOS[@]:0:5} ==="
for repo in "${REPOS[@]:0:5}"; do
  run_one "$repo" &
done
wait

# Batch 2: next 5 repos
echo "=== Batch 2: ${REPOS[@]:5:5} ==="
for repo in "${REPOS[@]:5:5}"; do
  run_one "$repo" &
done
wait

# Batch 3: last 4 repos
echo "=== Batch 3: ${REPOS[@]:10:4} ==="
for repo in "${REPOS[@]:10:4}"; do
  run_one "$repo" &
done
wait

echo "=== ALL DONE ==="
echo "--- Results ---"
for repo in "${REPOS[@]}"; do
  dir="research-${repo}-${DATE}"
  if [ -s "${dir}/evidence-brief.md" ]; then
    size=$(wc -c < "${dir}/evidence-brief.md")
    echo "OK   ${repo} (${size} bytes)"
  else
    echo "FAIL ${repo}"
  fi
done
