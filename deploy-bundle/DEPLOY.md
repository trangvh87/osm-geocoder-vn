# Hướng dẫn triển khai OFFLINE — OSM Geocoding Stack Việt Nam

Bundle này chứa **toàn bộ** images + dữ liệu đã import. Máy đích
**KHÔNG cần kết nối internet**, chỉ cần Docker đã cài sẵn.

## Nội dung bundle

| File | Dung lượng | Mô tả |
|---|---|---|
| `images.tar` | 526MB | Docker images: Nominatim 4.4, Meilisearch v1.11, geoproxy 1.0, alpine (tiện ích bung volume) |
| `vol-nominatim-data.tgz` | 3.0GB | PostgreSQL data — OSM Việt Nam **đã import xong** |
| `vol-meili-data.tgz` | 590MB | Meilisearch index — 470,020 địa điểm |
| `app/` | — | docker-compose.yml, Dockerfile, proxy, index script |
| `restore-windows.ps1` | — | Script restore tự động cho Windows |
| `restore-linux.sh` | — | Script restore tự động cho Linux |

Tổng: ~4.1GB

## Yêu cầu máy đích

- Windows (Docker Desktop + WSL2) hoặc Linux (Docker Engine + compose plugin)
- RAM trống ≥ 6GB, Disk trống ≥ 15GB
- Docker đang chạy. Không cần internet.

## Triển khai

### Windows
```powershell
.\restore-windows.ps1            # mặc định cài vào C:\osm-geocode
# hoặc chỉ định thư mục:
.\restore-windows.ps1 -TargetDir "D:\osm-geocode"
```

### Linux
```bash
bash restore-linux.sh            # mặc định cài vào /opt/osm-geocode
# hoặc:
bash restore-linux.sh /data/osm-geocode
```

Script tự động thực hiện: load images → tạo volumes → bung dữ liệu →
`docker compose up -d` → verify API (chạy trong container, không cần curl/wget trên host).

Thời gian ~5-10 phút tùy disk.

### Máy chủ CHỈ có Docker (không cài thêm được gì)

Toàn bộ quy trình chỉ dùng lệnh Docker — script không cần curl, wget,
python hay gói nào trên host. Nếu không chạy được script vì lý do nào đó,
thực hiện thủ công từng lệnh sau:

```bash
cd /duong/dan/deploy-bundle

# 1. Load images
docker load -i images.tar

# 2. Tạo + bung volume PostgreSQL (Nominatim)
docker volume create osm-geocode_nominatim-data
docker run --rm \
  --mount source=osm-geocode_nominatim-data,target=/data \
  --mount type=bind,"source=$(pwd)",target=/backup \
  alpine sh -c "cd /data && tar xzf /backup/vol-nominatim-data.tgz"

# 3. Tạo + bung volume Meilisearch
docker volume create osm-geocode_meili-data
docker run --rm \
  --mount source=osm-geocode_meili-data,target=/data \
  --mount type=bind,"source=$(pwd)",target=/backup \
  alpine sh -c "cd /data && tar xzf /backup/vol-meili-data.tgz"

# 4. Copy app/ ra thư mục chạy (tên thư mục = tên project compose)
mkdir -p /opt/osm-geocode && cp app/* /opt/osm-geocode/
cd /opt/osm-geocode

# 5. Chạy stack
docker compose up -d

# 6. Verify sau ~30s (exec trong container, không cần gì trên host)
docker exec geoproxy sh -c \
  "wget -qO- 'http://localhost:3000/search?q=63%20le%20van%20luong&format=json'"
```

⚠ Quan trọng: volume phải đặt đúng tên `osm-geocode_*` VÀ compose được chạy
từ thư mục tên `osm-geocode` (bước 4) để project name khớp với volume.

## Kiểm tra sau triển khai

```bash
docker compose ps        # 3 container Up: nominatim-local, meilisearch-vn, geoproxy
curl "http://localhost:8083/search?q=63%20le%20van%20luong&format=json"
```

Kết quả mong đợi — kết quả đầu tiên:
`Tòa nhà Tổng Công ty 319, 63, Đường Lê Văn Lương, ... Thành phố Hà Nội`

| Endpoint | Mô tả |
|---|---|
| `http://localhost:8083/search?q=...` | API chính (thông minh, format Nominatim) |
| `http://localhost:8083/reverse?lat=..&lon=..` | Reverse geocoding |
| `http://localhost:8080/search?q=...` | Nominatim gốc — chỉ nên dùng nội bộ |

## Đổi port / đổi master key

Sửa file `docker-compose.yml` trong thư mục cài đặt:

```yaml
ports:
  - "9999:3000"          # đổi port public bên trái
environment:
  - MEILI_KEY=key-moi-cua-ban   # đặt giống nhau ở service meilisearch và geoproxy
```
Rồi chạy `docker compose up -d`.

⚠ Nếu đổi `MEILI_KEY`, Meilisearch cũ vẫn hoạt động nhưng nên giữ key
không đổi để tương thích với index đã restore.

## Lưu ý vận hành offline

- Container Nominatim kiểm tra marker `import-finished` trong volume Postgres —
  vì dữ liệu đã restore sẵn nên **không tải PBF từ internet**
- Image geoproxy (`osm-geoproxy:1.0`) đã build sẵn — compose sẽ không build lại
- Chạy lại index (`node index-meili.js`) chỉ cần khi có PBF/data mới — yêu cầu internet

## Khắc phục sự cố

| Hiện tượng | Xử lý |
|---|---|
| `port already allocated` | Đổi port trong docker-compose.yml rồi `docker compose up -d` |
| Proxy trả kết quả fallback Nominatim chậm | Meili chưa lên kịp: `docker compose logs meilisearch` |
| Postgres lỗi permission sau restore | `docker compose down && docker compose up -d` (chạy lại 1 lần) |
| WSL error trên Windows mới | Cài Docker Desktop theo docs, bật WSL2 integration |
