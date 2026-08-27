#!/usr/bin/env bash
# Restore script - Linux (Ubuntu/Debian/CentOS co Docker)
# KHONG can internet. Yeu cau: docker + docker compose plugin da cai san
# Usage: sudo bash restore-linux.sh [/du/lieu/dich]

set -e

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-/opt/osm-geocode}"
APP_NAME="osm-geocode"

echo "=== Restore OSM Geocoding Stack ==="
echo "Bundle : $BUNDLE_DIR"
echo "Target : $TARGET_DIR"

mkdir -p "$TARGET_DIR"
cp "$BUNDLE_DIR"/app/* "$TARGET_DIR"/
cd "$TARGET_DIR"

echo "[1/4] Loading Docker images (~547MB)..."
docker load -i "$BUNDLE_DIR/images.tar"

echo "[2/4] Restoring PostgreSQL volume (Nominatim, ~3GB)..."
docker volume create ${APP_NAME}_nominatim-data >/dev/null
docker run --rm \
  --mount "source=${APP_NAME}_nominatim-data,target=/data" \
  --mount "type=bind,source=$BUNDLE_DIR,target=/backup" \
  alpine sh -c "cd /data && tar xzf /backup/vol-nominatim-data.tgz"

echo "[3/4] Restoring Meilisearch volume (~590MB)..."
docker volume create ${APP_NAME}_meili-data >/dev/null
docker run --rm \
  --mount "source=${APP_NAME}_meili-data,target=/data" \
  --mount "type=bind,source=$BUNDLE_DIR,target=/backup" \
  alpine sh -c "cd /data && tar xzf /backup/vol-meili-data.tgz"

echo "[4/5] Starting stack..."
docker compose up -d

echo "[5/5] Cho Nominatim warm (~30s) roi verify bang container alpine..."
sleep 30

if docker exec geoproxy sh -c \
    "wget -qO- --timeout=15 'http://localhost:3000/search?q=63%20le%20van%20luong&format=json' >/dev/null 2>&1"; then
  echo "VERIFY OK: http://localhost:8083 hoat dong"
else
  echo "VERIFY THAT BAI - kiem tra: docker compose ps && docker compose logs geoproxy"
  exit 1
fi

echo ""
echo "Hoan tat! API: http://localhost:8083 | Nominatim noi bo: http://localhost:8080"