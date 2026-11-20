#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v uv >/dev/null 2>&1; then
  printf '%s\n' '请先安装 uv，并确认它位于 PATH 中。' >&2
  exit 1
fi
if [ ! -f frontend/dist/index.html ] || [ ! -f student-web/dist/index.html ]; then
  printf '%s\n' '请解压完整的本机包。源码工作区须先按 README 构建两套前端。' >&2
  exit 1
fi
: "${UVICORN_PORT:=8776}"
export UVICORN_PORT
printf '课堂地址 http://127.0.0.1:%s/explore/\n' "$UVICORN_PORT"
exec uv run --no-project --python 3.12 --with-requirements requirements-edu.lock \
  python -m uvicorn services.simulation.api:app --host 127.0.0.1 --no-proxy-headers
