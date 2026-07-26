#!/bin/bash
# Batch regenerate evidence-brief.md AND report.md for all ref-only repos using the latest skill.
# Runs N repos in parallel (PARALLEL=4) to bound memory/CPU.
# Usage: bash run-all-repos-v2.sh [par_level]
set -u

PARALLEL="${1:-4}"
DATE=20260726
SKILL=.trae/skills/research-repo/research-repo.mjs
SKILL_VERSION=$(stat -f "%m" "$SKILL")

REPOS=(
  OfficeCLI ResearchStudio Vibe-Trading buzz code-review-graph
  custodian-kernel dbeaver litehybrid ng-zorro-antd open-design
  openworker page-agent pi pyod tensortrade topcoat unsloth worldmonitor
  Auto-Empirical-Research-Skills
)

echo "Skill mtime: ${SKILL_VERSION} ($(date -r ${SKILL_VERSION}))"
echo "Parallel: ${PARALLEL}, Total repos: ${#REPOS[@]}"
echo "Start: $(date)"

run_one() {
  local repo="$1"
  local dir="research-${repo}-${DATE}"
  mkdir -p "$dir"
  local brief="${dir}/evidence-brief.md"
  local report="${dir}/report.md"
  local err="${dir}/stderr.log"

  # Skip if both files exist AND were generated after SKILL_VERSION
  if [ -s "$brief" ] && [ -s "$report" ]; then
    brief_mtime=$(stat -f "%m" "$brief" 2>/dev/null || echo 0)
    report_mtime=$(stat -f "%m" "$report" 2>/dev/null || echo 0)
    if [ "$brief_mtime" -gt "$SKILL_VERSION" ] && [ "$report_mtime" -gt "$SKILL_VERSION" ]; then
      echo "SKIP ${repo} (already up-to-date)"
      return 0
    fi
  fi

  # Step 1: evidence-brief.md (analyzes repo + writes Evidence Brief)
  if ! node "$SKILL" report "ref-only/$repo" --lang=zh > "$brief" 2> "$err"; then
    echo "FAIL ${repo} (evidence-brief step, see ${err})"
    return 1
  fi

  # Step 2: report.md (LLM-generated from evidence-brief)
  # The skill itself doesn't have a separate report sub-command — `report` already
  # produces the evidence-brief; the LLM-generated report.md is produced by reading
  # evidence-brief.md and asking the LLM. Since CLI LLM is not available in this
  # environment, we leave report.md untouched if it exists; otherwise empty.
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
