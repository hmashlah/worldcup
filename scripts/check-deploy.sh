#!/bin/sh
# Check Cloudflare Pages deployment status, polling until resolved.
# Usage: ./scripts/check-deploy.sh

PROJECT="worldcup"
MAX_ATTEMPTS=12
INTERVAL=10

echo "Checking deploy status for '$PROJECT'..."

for i in $(seq 1 $MAX_ATTEMPTS); do
  OUTPUT=$(npx wrangler pages deployment list --project-name "$PROJECT" 2>/dev/null)
  # Extract the first data row (skip header lines)
  ROW=$(echo "$OUTPUT" | grep "│ Production" | head -1)
  
  if [ -z "$ROW" ]; then
    echo "  [$i/$MAX_ATTEMPTS] Waiting for data... (${INTERVAL}s)"
    sleep $INTERVAL
    continue
  fi

  COMMIT=$(echo "$ROW" | grep -oE "[a-f0-9]{7}" | head -1)
  STATUS=$(echo "$ROW" | awk -F'│' '{print $7}' | xargs)

  # "Failure" means build failed
  if echo "$STATUS" | grep -qi "failure"; then
    echo "✗ Deploy FAILED ($COMMIT)"
    exit 1
  fi

  # A time-based status like "2 minutes ago" or "just now" means success
  if echo "$STATUS" | grep -qiE "ago|just now|second|minute|hour|day"; then
    echo "✓ Deploy SUCCESS ($COMMIT) — $STATUS"
    exit 0
  fi

  echo "  [$i/$MAX_ATTEMPTS] Building... ($STATUS) (waiting ${INTERVAL}s)"
  sleep $INTERVAL
done

echo "⚠ Timed out after $((MAX_ATTEMPTS * INTERVAL))s — check manually"
exit 2
