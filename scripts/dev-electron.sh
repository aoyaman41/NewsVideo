#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not available in PATH." >&2
  exit 1
fi

# Keep IPC JS in sync with TS during Electron dev.
npx tsc -p tsconfig.node.json --watch &
tsc_pid=$!

cleanup() {
  kill "$tsc_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run electron:dev
