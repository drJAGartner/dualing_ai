#!/bin/sh
# Start Lucy's ADK server in the background, then the adapter in the foreground.
set -e

# A --env-file overrides the image's own ENV, so a .env carrying host cert
# paths would put Lucy back into SSL mode and it would die on a missing file.
# Force these off here, at runtime, where nothing can override us.
export ADK_SSL_CERTFILE=
export ADK_SSL_KEYFILE=
# RBAC short-circuits only when this is empty; a .env from the real deployment
# will have it set, which would then reject every unauthenticated request.
export OAUTH_AZURE_AD_HYBRID_CLIENT_ID=

# This local comparison harness does not need Lucy's Langfuse/OTEL traces.
# The dev Key Vault can contain stale Langfuse credentials, which causes noisy
# "Failed to export span batch code: 401" logs even though prompts succeed.
export OTEL_SDK_DISABLED="${OTEL_SDK_DISABLED:-true}"

export ADK_SERVER_PORT="${LUCY_INTERNAL_PORT:-8000}"
python -m pscm_agents_adk.server &
LUCY_PID=$!

# Wait for Lucy to become healthy — agent-graph construction takes ~40s.
echo "waiting for Lucy on :${ADK_SERVER_PORT} ..."
i=0
while [ $i -lt 90 ]; do
  if python -c "import urllib.request,sys; urllib.request.urlopen('http://localhost:${ADK_SERVER_PORT}/health',timeout=2)" 2>/dev/null; then
    echo "Lucy healthy after ${i}s"; break
  fi
  # If Lucy died, don't keep waiting for a corpse.
  kill -0 "$LUCY_PID" 2>/dev/null || { echo "Lucy exited during startup"; exit 1; }
  i=$((i+1)); sleep 1
done

export LUCY_URL="http://localhost:${ADK_SERVER_PORT}"
exec python /adapter/adapter.py
