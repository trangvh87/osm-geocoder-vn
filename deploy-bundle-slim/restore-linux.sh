#!/usr/bin/env bash
# Restore script SLIM (chi Meilisearch + proxy, khong Nominatim) - Linux
# Chi can Docker. KHONG can internet, khong can curl/wget tren host.
# Usage: bash restore-linux.sh [/du/lieu/dich]

set -e

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-/opt/osm-geocode}"
APP_NAME="osm-geocode"

echo "=== Restore OSM Geocoding Stack (SLIM) ==="
echo "Bundle : $BUNDLE_DIR"
echo "Target : $TARGET_DIR"

mkdir -p "$TARGET_DIR"
cp "$BUNDLE_DIR"/app/* "$TARGET_DIR"/
cd "$TARGET_DIR"

echo "[1/4] Loading Docker images (~143MB)..."
docker load -i "$BUNDLE_DIR/images.tar"

echo "[2/4] Restoring Meilisearch volume (~590MB)..."
docker volume create ${APP_NAME}_meili-data >/dev/null
docker run --rm \
  --mount "source=${APP_NAME}_meili-data,target=/data" \
  --mount "type=bind,source=$BUNDLE_DIR,target=/backup" \
  alpine sh -c "cd /data && tar xzf /backup/vol-meili-data.tgz"

echo "[3/4] Starting stack..."
docker compose up -d

echo "[4/4] Cho warm (~20s) roi verify bang docker exec..."
sleep 20

if docker exec geoproxy sh -c \
    "wget -qO- --timeout=15 'http://localhost:3000/search?q=63%20le%20van%20luong&format=json' >/dev/null 2>&1"; then
  echo "VERIFY OK: http://localhost:8083 hoat dong"
else
  echo "VERIFY THAT BAI - kiem tra: docker compose ps && docker compose logs geoproxy"
  exit 1
fi

echo ""
echo "Hoan tat! API: http://localhost:8083 (forward search + reverse geo-simplified)"