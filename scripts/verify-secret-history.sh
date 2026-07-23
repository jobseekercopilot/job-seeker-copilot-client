#!/usr/bin/env sh
set -eu

image=${1:-zricethezav/gitleaks:v8.30.1}
repository=${2:-$(git rev-parse --show-toplevel)}
repository=$(cd "$repository" && pwd -P)
report=$(mktemp)
trap 'rm -f "$report"' EXIT INT TERM

if ! docker run --rm \
        --volume "$repository:/repository:ro" \
        --workdir /repository \
        --entrypoint sh \
        "$image" \
        -c 'set -eu
            git config --global --add safe.directory /repository
            commit_count=$(git rev-list --count --all)
            test "$commit_count" -gt 0
            gitleaks git --no-banner --redact --exit-code 1 /repository' \
        >"$report" 2>&1; then
    cat "$report"
    exit 1
fi

cat "$report"
if ! grep -E '[1-9][0-9]* commits scanned' "$report" >/dev/null; then
    echo "secret history scan failed closed: no non-zero commit evidence" >&2
    exit 1
fi
