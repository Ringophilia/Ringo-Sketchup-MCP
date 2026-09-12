#!/bin/sh
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 22 or 24 LTS from https://nodejs.org, then run again.'
  exit 1
fi
node scripts/setup.mjs "$@"
