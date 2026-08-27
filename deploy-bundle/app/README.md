# Hệ thống Geocoding Việt Nam — Nominatim + Meilisearch

Hệ thống tra cứu địa chỉ Việt Nam cục bộ (local), xây dựng trên 3 tầng:

```
┌──────────────┐
│   Client     │
└──────┬───────┘
       │ http://localhost:3000/search?q=63 le van luong
       ▼
┌─────────────────────────────────────────────┐
│  smart-proxy.js (Node.js, port 3000)        │
│  - Chuẩn hóa query: bỏ dấu, lọc từ loại     │
│  - Gọi Meilisearch trước                    │
│  - Fallback Nominatim nếu 0 kết quả         │
└──────┬──────────────────────┬───────────────┘
       │                      │
       ▼                      ▼
┌──────────────────┐   ┌──────────────────────┐
│ Meilisearch      │   │ Nominatim 4.4        │
│ port 7700        │   │ port 8080            │
│ Fulltext search  │   │ Geocoder chuẩn OSM   │
│ 470,020 docs     │   │ PostgreSQL + PostGIS │
│ typo-tolerant    │   │ dữ liệu OSM Việt Nam │
└────────┬─────────┘   └──────────────────────┘
         │ index-meili.js
         ▼
┌─────────────────────────────────────────────┐
│ Extract từ placex (recursive CTE theo       │
│ parent_place_id) → normalize → upload NDJSON│
└─────────────────────────────────────────────┘
```

## Tại sao cần Meilisearch thay vì chỉ dùng Nominatim?

Nominatim tìm kiếm chính xác theo token nhưng yếu khi:
- Người dùng gõ **không dấu**: `le van luong` khó khớp `Lê Văn Lương`
- Thiếu từ loại: `63 le van luong` không ra kết quả số nhà, phải gõ `63 duong le van luong`
- Lỗi chính tả: `luom` không tự sửa thành `luong`

Meilisearch giải quyết cả 3 vấn đề nhờ:
1. **Normalize hai phía** — index và query đều được bỏ dấu (`stripDiacritics`) và lọc từ loại (`đường, phố, phường, quận, huyện, xã, thị, trấn, tp, tỉnh, số`), nên `63 duong le van luong` ≡ `63 le van luong` ≡ `63 lê văn lương`
2. **Typo tolerance** — chấp nhận 1-2 ký tự sai tùy độ dài từ
3. **Tốc độ** — ~10-50ms/query trên bộ dữ liệu toàn quốc

## Cấu trúc thư mục

| File | Mô tả |
|---|---|
| `docker-compose.yml` | Định nghĩa 2 container: `nominatim-local`, `meilisearch-vn` |
| `index-meili.js` | Script extract dữ liệu từ Postgres → index vào Meilisearch |
| `smart-proxy.js` | API proxy port 3000 (Meilisearch → fallback Nominatim) |
| `package.json` | Dependencies Node.js (express, axios) |

## Khởi chạy lần đầu

### 1. Chạy containers

```bash
docker compose up -d
```

Lần đầu, container Nominatim sẽ tự động:
- Tải dữ liệu OSM Việt Nam (~311MB) từ geofabrik.de
- Import vào PostgreSQL/PostGIS (**mất 1-3 tiếng**, xem tiến độ bằng `docker logs -f nominatim-local`)
- Khởi động API tại cổng 8080

### 2. Index dữ liệu vào Meilisearch

```bash
npm install
node index-meili.js
```

Script thực hiện:
1. Kết nối vào Postgres trong container Nominatim qua `docker exec`
2. Export bảng `placex` (470,022 địa điểm có tên/số nhà), đi lên chuỗi cha-con bằng recursive CTE để lấy đầy đủ ngữ cảnh địa chỉ (`context`)
3. Normalize: bỏ dấu tiếng Việt, lowercase, lọc từ loại
4. Upload theo batch 20,000 docs dạng NDJSON
5. Cấu hình index: searchable `stext`, sortable `_geo`, ranking rules + `importance:desc`

Thời gian: ~5 phút.

### 3. Chạy proxy

```bash
node smart-proxy.js
```

## Sử dụng API

### Search (khuyên dùng qua proxy :3000)

```
http://localhost:3000/search?q=63 le van luong&format=json
http://localhost:3000/search?q=144 xuân thủy&format=json&limit=5
```

Các biến thể query đều cho cùng kết quả:

| Query | Ghi chú |
|---|---|
| `63 le van luong` | không dấu, thiếu từ loại ✓ |
| `63 lê văn lương` | có dấu ✓ |
| `le van luom` | lỗi chính tả ✓ |
| `so 144 duong xuan thuy ha noi` | viết tắt "so"/"duong" ✓ |

Response format **giống hệt Nominatim gốc**:

```json
{
  "place_id": 525827,
  "licence": "Data © OpenStreetMap contributors, ODbL 1.0.",
  "osm_type": "W",
  "osm_id": 849491244,
  "boundingbox": ["21.0079218", "21.0082943", "105.8076777", "105.8082677"],
  "lat": "21.0080556",
  "lon": "105.807981",
  "display_name": "Tòa nhà Tổng Công ty 319, 63, Đường Lê Văn Lương, ...",
  "class": "building",
  "type": "office",
  "importance": 0.0000099
}
```

### Reverse geocoding (passthrough Nominatim)

```
http://localhost:3000/reverse?lat=21.03681&lon=105.78286&format=json
```

### Gọi trực tiếp các tầng dưới

| URL | Dùng khi |
|---|---|
| `http://localhost:8080/search?q=...` | Cần params nâng cao của Nominatim (`addressdetails`, `extratags`, `viewbox`...) |
| `POST http://localhost:7700/indexes/places/search` | Cần search engine thuần (filter, facet, geo-sort) |

Meilisearch yêu cầu header `Authorization: Bearer vn-geocode-key-2026`.

## Bảo trì

### Cập nhật dữ liệu OSM mới

Dữ liệu geofabrik cập nhật hằng ngày. Để refresh:

```bash
# Xóa volume Postgres và import lại từ đầu (1-3 tiếng)
docker compose down
docker volume rm openstreetmap_nominatim-data
docker compose up -d
# chờ import xong rồi chạy lại:
node index-meili.js
```

### Kiểm tra trạng thái

```bash
docker compose ps                          # 2 container đang chạy
curl http://localhost:7700/health          # Meilisearch health
docker logs -f nominatim-local             # log Nominatim
```

## Hạn chế đã biết

- Proxy bỏ qua params nâng cao của Nominatim (`addressdetails=1`, `extratags=1`, `viewbox`, `countrycodes`...) — không lỗi nhưng không có hiệu lực; cần thì gọi thẳng :8080
- Số nhà phụ thuộc dữ liệu OSM Việt Nam — khu vực cộng tác viên OSM nhập ít sẽ thiếu
- Dữ liệu tĩnh tại thời điểm import, không tự đồng bộ replication

## Yêu cầu hệ thống

- Docker Desktop + WSL2 (Windows)
- RAM ≥ 8GB (Postgres chiếm ~2GB khi import)
- Disk ≥ 10GB (volume Postgres + Meilisearch)
