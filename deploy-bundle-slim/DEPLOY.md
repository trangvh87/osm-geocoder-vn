# Hướng dẫn triển khai OFFLINE — Bản SLIM (chỉ Meilisearch + Proxy)

Bản rút gọn ~734MB: **không có Nominatim**. Forward search đầy đủ tính năng,
reverse geocoding dạng đơn giản hóa (điểm gần nhất theo tọa độ).

## Khác biệt so với bản full

| | Full (4.1GB) | Slim (734MB) |
|---|---|---|
| Forward search `/search` | ✅ | ✅ giống hệt |
| Reverse `/reverse` | ✅ chuẩn Nominatim | ⚠ đơn giản hóa (geo-nearest) |
| Fallback khi Meili lỗi | ✅ Nominatim | ❌ trả `[]` |
| Cập nhật dữ liệu sau này | Cần internet | Không (data khóa ở bản hiện tại) |

## Nội dung bundle

| File | Size | Mô tả |
|---|---|---|
| `images.tar` | 143MB | Meilisearch v1.11 + geoproxy 1.0 + alpine |
| `vol-meili-data.tgz` | 590MB | Index 470,020 địa điểm |
| `app/` | — | docker-compose.yml (2 service), smart-proxy.js |
| `restore-windows.ps1` / `restore-linux.sh` | — | Script tự động |

## Triển khai — chỉ cần Docker, không cần internet

### Windows
```powershell
.\restore-windows.ps1              # mặc định cài vào C:\osm-geocode
```

### Linux
```bash
bash restore-linux.sh /opt/osm-geocode
```

Thủ công từng bước nếu không chạy được script:

```bash
cd /duong/dan/deploy-bundle-slim
docker load -i images.tar
docker volume create osm-geocode_meili-data
docker run --rm \
  --mount source=osm-geocode_meili-data,target=/data \
  --mount type=bind,"source=$(pwd)",target=/backup \
  alpine sh -c "cd /data && tar xzf /backup/vol-meili-data.tgz"
mkdir -p /opt/osm-geocode && cp app/* /opt/osm-geocode/
cd /opt/osm-geocode
docker compose up -d
# verify sau 20s:
docker exec geoproxy sh -c \
  "wget -qO- 'http://localhost:3000/search?q=63%20le%20van%20luong&format=json'"
```

⚠ Tên thư mục cài đặt phải là `osm-geocode` để khớp project compose ↔ volume.

## Kiểm tra

```bash
docker compose ps   # 2 container Up: meilisearch-vn, geoproxy
curl "http://localhost:8083/search?q=63%20le%20van%20luong&format=json"
curl "http://localhost:8083/reverse?lat=21.03681&lon=105.78286&format=json"
```

| Endpoint | Ghi chú bản slim |
|---|---|
| `/search?q=...` | Giống hệt bản full (Meili chính, format Nominatim) |
| `/reverse?lat=..&lon=..` | Trả POI/địa điểm gần nhất — KHÔNG có chuỗi hành chính đầy đủ như Nominatim |

## Lưu ý

- Firewall: chỉ mở cổng **8083**; không mở 7700 ra ngoài
- `smart-proxy.js` được mount trực tiếp vào container (`./smart-proxy.js:/app/smart-proxy.js:ro`)
  → sửa file xong chỉ cần `docker compose restart geoproxy`, không cần build lại image
- Nếu sau này cần reverse chuẩn hoặc cập nhật map → dùng bundle FULL thay thế
