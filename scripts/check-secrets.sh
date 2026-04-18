#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

tmp_file="$(mktemp)"
filtered_files="$(mktemp)"
trap 'rm -f "$tmp_file" "$filtered_files"' EXIT

echo "Scanning tracked files for obvious secrets..."

tracked_envs="$(
  git ls-files \
    | rg '(^|/)\.env($|\.)' \
    | rg -v '(^|/)\.env(\.[^.]+)?\.example$' \
    || true
)"
if [[ -n "$tracked_envs" ]]; then
  echo
  echo "Tracked .env files found:"
  echo "$tracked_envs"
  exit 1
fi

git ls-files -z | while IFS= read -r -d '' file; do
  case "$file" in
    README.md|docs/*|audit/README.md|audit/docs/*|*.env.example)
      continue
      ;;
  esac
  printf '%s\0' "$file"
done > "$filtered_files"

matches="$(
  xargs -0 rg -n -I --color never \
    -e 'BEGIN [A-Z ]*PRIVATE KEY' \
    -e 'sk-ant-[A-Za-z0-9_-]+' \
    -e 'sk-proj-[A-Za-z0-9_-]+' \
    -e 'ghp_[A-Za-z0-9]+' \
    -e 'github_pat_[A-Za-z0-9_]+' \
    -e 'AIza[0-9A-Za-z_-]+' \
    -e 'ISSUER_PRIVATE_KEY[[:space:]]*[:=][[:space:]]*["'"'"']?0x[0-9a-fA-F]{64}' \
    -e 'X402_EVM_PRIVATE_KEY[[:space:]]*[:=][[:space:]]*["'"'"']?0x[0-9a-fA-F]{64}' \
    -e 'DEPLOYER_PRIVATE_KEY[[:space:]]*[:=][[:space:]]*["'"'"']?0x[0-9a-fA-F]{64}' \
    -e 'DATABASE_URL[[:space:]]*[:=][[:space:]]*["'"'"']?(postgres(ql)?://[^[:space:]]+:[^[:space:]]+@)' \
    < "$filtered_files" || true
)"

matches="$(printf '%s\n' "$matches" | rg -v 'change-me-to-a-long-random-secret-at-least-32-chars|YOUR_PASSWORD' || true)"

if [[ -n "$matches" ]]; then
  printf '%s\n' "$matches" | tee "$tmp_file"
  echo
  echo "Potential secrets found. Review the matches above before pushing."
  exit 1
fi

echo "No obvious secrets found in tracked source files."
