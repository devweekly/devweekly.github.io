#!/bin/bash
# Batch regenerate evidence-brief.md for all ref-only repos using the latest skill.
# Runs N repos in parallel (PARALLEL=4) to bound memory/CPU.
# Note: this script only generates evidence-brief.md. report.md must be produced
# separately by an LLM reading evidence-brief.md.
# Usage: bash run-all-repos-v2.sh [par_level]
set -u

PARALLEL="${1:-4}"
DATE=20260726
SKILL=.trae/skills/research-repo/research-repo.mjs

# Cross-platform file mtime (seconds since epoch)
file_mtime() {
  local f="$1"
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    stat -c %Y "$f" 2>/dev/null || echo 0
  else
    stat -f %m "$f" 2>/dev/null || echo 0
  fi
}

# Cross-platform format epoch as human-readable date
fmt_mtime() {
  local ts="$1"
  if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    date -d "@$ts" 2>/dev/null || echo "$ts"
  else
    date -r "$ts" 2>/dev/null || echo "$ts"
  fi
}

SKILL_VERSION=$(file_mtime "$SKILL")

REPOS=(
  OfficeCLI ResearchStudio Vibe-Trading buzz code-review-graph
  custodian-kernel dbeaver litehybrid ng-zorro-antd open-design
  openworker page-agent pi pyod tensortrade topcoat unsloth worldmonitor
  Auto-Empirical-Research-Skills
)

echo "Skill mtime: ${SKILL_VERSION} ($(fmt_mtime ${SKILL_VERSION}))"
echo "Parallel: ${PARALLEL}, Total repos: ${#REPOS[@]}"
echo "Start: $(date)"

run_one() {
  local repo="$1"
  local dir="research-${repo}-${DATE}"
  mkdir -p "$dir"
  local brief="${dir}/evidence-brief.md"
  local err="${dir}/stderr.log"

  # Skip if evidence-brief.md exists AND was generated after SKILL_VERSION
  if [ -s "$brief" ]; then
    local brief_mtime
    brief_mtime=$(file_mtime "$brief")
    if [ "$brief_mtime" -gt "$SKILL_VERSION" ]; then
      echo "SKIP ${repo} (already up-to-date)"
      return 0
    fi
  fi

  # Run analyzer to produce evidence-brief.md
  if ! node "$SKILL" report "ref-only/$repo" --lang=zh > "$brief" 2> "$err"; then
    echo "FAIL ${repo} (evidence-brief step, see ${err})"
    return 1
  fi

  echo "OK  ${repo} -> ${brief}"
}

# Process in parallel batches of $PARALLEL
i=0
for repo in "${REPOS[@]}"; do
  run_one "$repo" &
  i=$((i+1))
  if [ $((i % PARALLEL)) -eq 0 ]; then
    wait
  fi
done
wait

echo "=== All done at $(date) ==="
echo "--- Results ---"
for repo in "${REPOS[@]}"; do
  dir="research-${repo}-${DATE}"
  brief_size=$(wc -c < "$dir/evidence-brief.md" 2>/dev/null || echo 0)
  report_size=$(wc -c < "$dir/report.md" 2>/dev/null || echo 0)
  printf "%-32s brief=%6s  report=%6s\n" "$repo" "$brief_size" "$report_size"
done
