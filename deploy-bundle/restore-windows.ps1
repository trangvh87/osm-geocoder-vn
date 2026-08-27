# Restore script - Windows PowerShell (chay voi quyen Administrator hoac user trong nhom docker-users)
# Yeu cau: Docker Desktop da khoi dong, khong can internet
# Usage: .\restore-windows.ps1 [thu_muc_dich]

param(
    [string]$TargetDir = "C:\osm-geocode"
)

$ErrorActionPreference = "Stop"
$BundleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName = "osm-geocode"

Write-Host "=== Restore OSM Geocoding Stack ===" -ForegroundColor Cyan
Write-Host "Bundle : $BundleDir"
Write-Host "Target : $TargetDir"

# 1. Copy code sang thu muc dich
New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item "$BundleDir\app\*" -Destination $TargetDir -Recurse -Force

Push-Location $TargetDir

# 2. Load images (khong can internet)
Write-Host "`n[1/4] Loading Docker images (~547MB)..." -ForegroundColor Yellow
docker load -i "$BundleDir\images.tar"

# 3. Tao volumes va restore data
Write-Host "[2/4] Restoring PostgreSQL volume (Nominatim, ~3GB)..." -ForegroundColor Yellow
docker volume create ${AppName}_nominatim-data | Out-Null
docker run --rm --mount "source=${AppName}_nominatim-data,target=/data" --mount "type=bind,source=$BundleDir,target=/backup" alpine sh -c "cd /data && tar xzf /backup/vol-nominatim-data.tgz"

Write-Host "[3/4] Restoring Meilisearch volume (~590MB)..." -ForegroundColor Yellow
docker volume create ${AppName}_meili-data | Out-Null
docker run --rm --mount "source=${AppName}_meili-data,target=/data" --mount "type=bind,source=$BundleDir,target=/backup" alpine sh -c "cd /data && tar xzf /backup/vol-meili-data.tgz"

# 4. Khoi dong stack
Write-Host "[4/4] Starting stack..." -ForegroundColor Yellow
docker compose up -d

# 5. Verify (exec trong container geoproxy, khong phu thuoc curl tren host)
Write-Host "`nCho Nominatim warm (~30s)..." -ForegroundColor Yellow
Start-Sleep -Seconds 30
$ok = docker exec geoproxy sh -c "wget -qO- --timeout=15 'http://localhost:3000/search?q=63%20le%20van%20luong&format=json' >/dev/null 2>&1 && echo OK"
if ("$ok".Contains("OK")) {
    Write-Host "VERIFY OK: API hoat dong" -ForegroundColor Green
} else {
    Write-Host "VERIFY THAT BAI - kiem tra: docker compose ps ; docker compose logs geoproxy" -ForegroundColor Red
}

Pop-Location
Write-Host "`nHoan tat! API: http://localhost:8083 | Nominatim noi bo: http://localhost:8080" -ForegroundColor Cyan