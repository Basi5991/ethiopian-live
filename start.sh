#!/usr/bin/env bash
set -o errexit

# Works whether Render root directory is repo root or backend/.
if [ -f "terjuman/asgi.py" ]; then
  APP_DIR="."
elif [ -f "backend/terjuman/asgi.py" ]; then
  APP_DIR="backend"
else
  echo "Could not locate terjuman.asgi. cwd=$(pwd)" >&2
  exit 1
fi

cd "$APP_DIR"
echo "Starting Daphne from $(pwd) on port ${PORT:-8000}"
exec daphne -b 0.0.0.0 -p "${PORT:-8000}" terjuman.asgi:application
