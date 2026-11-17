#!/usr/bin/env bash

BASE_URL="http://localhost:8085"
TOTAL_REQUESTS=500

echo "Launching $TOTAL_REQUESTS concurrent /ingest requests + parallel /health checks..."

for i in $(seq 1 $TOTAL_REQUESTS); do
  curl -s -o /dev/null "$BASE_URL/ingest?id=$((1000 + i))" &
done

for j in $(seq 1 10); do
  START=$(date +%s%3N)
  HEALTH_RES=$(curl -s "$BASE_URL/health")
  END=$(date +%s%3N)
  echo "[HEALTH #$j] Response: $HEALTH_RES | Latency: $((END - START)) ms"
  sleep 0.05
done

wait

echo ""
echo "Final cluster metrics:"
curl -s "$BASE_URL/metrics"
echo ""