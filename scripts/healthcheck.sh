#!/bin/bash

# Simple LOC healthcheck script

DETAILED=false
if [ "$1" = "--detailed" ] || [ "$1" = "-d" ]; then
  DETAILED=true
fi

count_stats() {
  local dir=$1
  local files=$(git ls-files "$dir" 2>/dev/null | grep -vE '\.(json|md)$' | grep -E '\.(ts|tsx|js|jsx|css)$')

  if [ -z "$files" ]; then
    echo "  (no source files)"
    return
  fi

  local num_files=$(echo "$files" | wc -l | tr -d ' ')
  local total_loc=0

  while IFS= read -r file; do
    if [ -f "$file" ]; then
      loc=$(wc -l < "$file" | tr -d ' ')
      total_loc=$((total_loc + loc))
      if [ "$DETAILED" = true ]; then
        printf "    %4d  %s\n" "$loc" "$file"
      fi
    fi
  done <<< "$files"

  local avg_loc=$((total_loc / num_files))

  printf "  files: %d | total LOC: %d | avg LOC: %d\n" "$num_files" "$total_loc" "$avg_loc"

  # Return values for aggregation
  echo "$num_files $total_loc" >> /tmp/healthcheck_totals
}

# Clear temp file
> /tmp/healthcheck_totals

echo "=== HEALTHCHECK ==="
echo ""

# Apps
echo "APPS:"
for dir in apps/*/; do
  if [ -d "$dir" ]; then
    echo "${dir%/}:"
    count_stats "$dir"
  fi
done

echo ""

# Packages
echo "PACKAGES:"
for dir in packages/*/; do
  if [ -d "$dir" ]; then
    echo "${dir%/}:"
    count_stats "$dir"
  fi
done

echo ""

# Repo-wide totals
echo "=== REPO TOTALS ==="
total_files=0
total_loc=0

while read -r files loc; do
  total_files=$((total_files + files))
  total_loc=$((total_loc + loc))
done < /tmp/healthcheck_totals

if [ "$total_files" -gt 0 ]; then
  avg_loc=$((total_loc / total_files))
  printf "total files: %d\n" "$total_files"
  printf "total LOC: %d\n" "$total_loc"
  printf "avg LOC: %d\n" "$avg_loc"
fi

rm -f /tmp/healthcheck_totals
