#!/usr/bin/env bash
# 画面の通し確認：一時的な DB でバックエンドとフロントエンドを起動し、Playwright で操作する。
#   hojinzei/scripts/e2e.sh            （先に frontend で npm run build しておく）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
# バックエンドの URL はフロントエンドのビルド時に決まる（next.config.ts の BACKEND_URL。既定は 127.0.0.1:8000）
BPORT=${BPORT:-8000}
FPORT=${FPORT:-3765}
cleanup() {
  # npx の下で動く next-server まで止める（プロセスグループごと）
  for p in ${BPID:-} ${FPID:-}; do kill -- -"$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done
  pkill -P "${FPID:-0}" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

set -m  # 子プロセスを別のプロセスグループで起動する
cd "$ROOT/backend"
DATABASE_URL="sqlite:///$TMP/e2e.db" HOJINZEI_DATA_DIR="$TMP/data" HOJINZEI_ENV=dev HOJINZEI_SEED_DEMO=1 \
  .venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port "$BPORT" >"$TMP/backend.log" 2>&1 &
BPID=$!
cd "$ROOT/frontend"
BACKEND_URL="http://127.0.0.1:$BPORT" npx next start -p "$FPORT" >"$TMP/frontend.log" 2>&1 &
FPID=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$FPORT/api/health" >/dev/null 2>&1 && break
  sleep 1
done
E2E_BASE="http://127.0.0.1:$FPORT" E2E_SAMPLES="$ROOT/samples" E2E_OUT="${E2E_OUT:-$TMP/shots}" node e2e/flow.mjs
