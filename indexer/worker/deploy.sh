#!/bin/sh
# Usage: indexer/worker/deploy.sh <railway-project-id> <railway-service-name>
# Uploads only the indexer sources to an existing Railway service; never touches the node.
set -eu
project="$1"
service="$2"
root="$(cd "$(dirname "$0")/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/indexer" "$tmp/lib"
cp "$root"/indexer/*.ts "$tmp/indexer/"
cp "$root/lib/rawblock.ts" "$tmp/lib/"
cp "$root/indexer/worker/Dockerfile" "$tmp/Dockerfile"
# The temp dir is not linked, so the project must be explicit or Railway creates a new one.
cd "$tmp" && railway up --project "$project" --environment production --service "$service" --ci
