# Restore script SLIM (chi Meilisearch + proxy, khong Nominatim) - Windows PowerShell
# Yeu cau: Docker Desktop da khoi dong. KHONG can internet.
# Usage: .\restore-windows.ps1 [-TargetDir "C:\osm-geocode"]

param(
    [string]$TargetDir = "C:\osm-geocode"
)

$ErrorActionPreference = "Stop"
$BundleDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName = "osm-geocode"

Write-Host "=== Restore OSM Geocoding Stack (SLIM) ===" -ForegroundColor Cyan
Write-Host "Bundle : $BundleDir"
Write-Host "Target : $TargetDir"

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item "$BundleDir\app\*" -Destination $TargetDir -Recurse -Force

Push-Location $TargetDir

Write-Host "`n[1/4] Loading Docker images (~143MB)..." -ForegroundColor Yellow
docker load -i "$BundleDir\images.tar"

Write-Host "[2/4] Restoring Meilisearch volume (~590MB)..." -ForegroundColor Yellow
docker volume create ${AppName}_meili-data | Out-Null
docker run --rm --mount "source=${AppName}_meili-data,target=/data" --mount "type=bind,source=$BundleDir,target=/backup" alpine sh -c "cd /data && tar xzf /backup/vol-meili-data.tgz"

Write-Host "[3/4] Starting stack..." -ForegroundColor Yellow
docker compose up -d

Write-Host "[4/4] Cho warm (~20s) roi verify..." -ForegroundColor Yellow
Start-Sleep -Seconds 20
$ok = docker exec geoproxy sh -c "wget -qO- --timeout=15 'http://localhost:3000/search?q=63%20le%20van%20luong&format=json' >/dev/null 2>&1 && echo OK"
if ("$ok".Contains("OK")) {
    Write-Host "VERIFY OK: API hoat dong" -ForegroundColor Green
} else {
    Write-Host "VERIFY THAT BAI - kiem tra: docker compose ps ; docker compose logs geoproxy" -ForegroundColor Red
}

Pop-Location
Write-Host "`nHoan tat! API: http://localhost:8083" -ForegroundColor Cyan