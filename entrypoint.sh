#!/bin/sh
set -e

# Start lightweight identity & sync daemon in background
echo "[entrypoint] Starting nuvio-sync daemon..."
node /app/server.cjs &

# Start Nginx in foreground
echo "[entrypoint] Starting nginx..."
exec nginx -g "daemon off;"
