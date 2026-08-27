# Báo cáo so sánh dữ liệu Meilisearch hiện tại vs Nguồn bổ sung

## 1. Tổng quan Meilisearch hiện tại

| Chỉ số | Giá trị |
|---|---|
| Tổng bản ghi | 470,020 |
| Admin boundaries (class=boundary) | 10,363 |
| Admin boundaries có type=administrative | ~8,311 |
| Có context (tên hành chính cha) | Đa số xã/phường có, cấp tỉnh không có |
| Có rank_address | **Không** (chưa index field này) |
| Có admin_level | **Không** (chưa index field này) |
| Dữ liệu hành chính | OSM Vietnam — đã có tên 34 tỉnh mới 2025 ✓ |

### Phân bố class trong Meilisearch

| Class | Số bản ghi | % |
|---|---|---|
| highway | 238,553 | 50.8% |
| amenity | 61,676 | 13.1% |
| place | 59,568 | 12.7% |
| building | 29,240 | 6.2% |
| shop | 22,374 | 4.8% |
| tourism | 13,774 | 2.9% |
| **boundary** | **10,363** | **2.2%** |
| waterway | 6,384 | 1.4% |
| landuse | 5,885 | 1.3% |
| office | 5,441 | 1.2% |
| Còn lại | 16,742 | 3.6% |

## 2. Mức độ bao phủ tên tỉnh sau sáp nhập 2025

### Tỉnh mới (sau Nghị quyết 202/2025/QH15 — 34 đơn vị)

| Tỉnh | Có trong Meilisearch? | Có trong Nominatim? | Ghi chú |
|---|---|---|---|
| Hà Nội | ✅ `Thành phố Hà Nội` imp=0.29 | ❌ | Meili tốt hơn |
| TP. Hồ Chí Minh | ✅ imp=0.29 | ❌ | |
| Đà Nẵng | ✅ imp=0.29 | ❌ | |
| Hải Phòng | ✅ imp=0.29 | ❌ | |
| Cần Thơ | ✅ imp=0.29 | ✅ | |
| Huế | ✅ imp=0.29 | ❌ | |
| Nghệ An | ✅ imp=0.29 | ✅ | |
| Thanh Hóa | ✅ imp=0.29 | ✅ | |

### Tỉnh cũ đã sáp nhập (không còn tồn tại)

| Tỉnh cũ | Sáp nhập vào | Có boundary trong Meili? | Kết luận |
|---|---|---|---|
| Hà Tây | Hà Nội (2008) | ❌ Đúng | OSM đã cập nhật |
| Hải Dương | Hưng Yên (2025?) | ❌ | Cần kiểm tra thêm |
| Bắc Giang | Bắc Ninh (2025?) | ❌ | Cần kiểm tra thêm |
| Quảng Nam | → tách | ❌ boundary riêng | Đúng (vẫn là tỉnh) |

**Kết luận:** Tên tỉnh mới 2025 **đã có trong OSM/Meilisearch**. Tên tỉnh cũ đã sáp nhập **không còn boundary riêng** → dữ liệu OSM đã cập nhật cơ bản.

## 3. So sánh với nguồn open-admin-data (sau sáp nhập 2025)

### open-admin-data cung cấp

| Field | OSM/Meili hiện tại | open-admin-data | Thêm được gì |
|---|---|---|---|
| Tên địa phương | ✅ `display` | ✅ `name.local` | Giống nhau |
| Tên tiếng Anh | ❌ | ✅ `name.en` | **Bổ sung được** |
| Mã hành chính | ❌ | ✅ `code.id` (01, 04, 08...) | **Bổ sung được** |
| Slug URL | ❌ | ✅ `name.slug` (ha-noi-01) | Bổ sung cho URL化 |
| Số xã con | ❌ | ✅ `children_count.ward` | Thống kê |
| Postal codes | ❌ | ✅ `zip_codes[]` | **Bổ sung được** |
| Lat/Lon toạ độ | ✅ `_geo` | ✅ `geo.lat/lon` | Giống nhau |
| Cấp hành chính | ❌ | ✅ `level` (1=tỉnh, 2=xã) | **Bổ sung được** |
| Cha (parent) | ✅ context string | ✅ parent object ref | Chi tiết hơn |

### Thống kê open-admin-data

| Level | Số lượng | Mô tả |
|---|---|---|
| 1 (Tỉnh/TP) | 34 | Đã cập nhật sau sáp nhập 01/07/2025 |
| 2 (Xã/Phường/TT) | 3,321 | Đơn vị hành chính cấp xã |

## 4. Khoảng trống cần bổ sung

### A. Field chưa index (quan trọng nhất)

| Field | Hiện tại | Cần làm | Ưu tiên |
|---|---|---|---|
| `admin_level` | Không có | Index từ Nominatim DB, dùng để filter "chỉ hiện tỉnh" hoặc "chỉ hiện xã" | **Cao** |
| `rank_address` | Không có | Index để sort theo cấp hành chính | **Cao** |
| `name_en` | Không có | Bổ sung từ open-admin-data cho 3,355 bản ghi hành chính | Trung bình |
| `admin_code` | Không có | Bổ sung mã hành chính chính thức (01, 04...) | Trung bình |

### B. Dữ liệu cần merge

| Nguồn | Số record | Dữ liệu chính | Cách merge |
|---|---|---|---|
| open-admin-data provinces | 34 | Tên EN, mã hành chính, postal codes | Upsert vào index với key `admin_province_{code}` |
| open-admin-data wards | 3,321 | Tên EN, mã, parent_ref, postal codes | Upsert, update context nếu cần |
| Nominatim placex | 470,020 | admin_level, rank_address | Update field thêm vào record hiện có |

### C. Vấn đề hiện tại trong Meilisearch

| Vấn đề | Mức độ | Giải pháp |
|---|---|---|
| Không filter được theo cấp hành chính | Cao | Index admin_level + rank_address |
| Context rỗng cho cấp tỉnh | Thấp | Bổ sung từ Nominatim hoặc open-admin-data |
| Thiếu tên tiếng Anh | Trung bình | Merge từ open-admin-data |
| Không có mã hành chính chính thức | Trung bình | Merge từ open-admin-data |
| Postal code chỉ có ở một số record | Thấp | Bổ sung từ open-admin-data zip_codes |

## 5. Khuyến nghị

### Ưu tiên1: Index thêm admin_level + rank_address

Trích xuất từ Nominatim DB (placex table) rồi update document trong Meilisearch. Đây là thay đổi nhỏ nhất nhưng impact lớn nhất — cho phép:
- `filter: 'admin_level = 4'` → chỉ hiện cấp xã
- `filter: 'admin_level = 6'` → chỉ hiện cấp huyện
- `filter: 'admin_level = 8'` → chỉ hiện cấp tỉnh
- `sort: ['rank_address:desc']` → kết quả hành chính xếp trên POI

**Lưu ý kỹ thuật:** Nominatim API search **không trả về admin_level** — field này chỉ có trong PostgreSQL (placex table). Cần trích xuất trực tiếp từ DB bằng SQL, không thể lấy qua API.

### Ưu tiên2: Merge dữ liệu hành chính mới 2025

Tải open-admin-data (34 tỉnh + 3,321 xã) rồi upsert vào Meilisearch:
- Thêm field `name_en`, `admin_code`, `postal_codes`
- Update `context` nếu OSM cũ sai (ví dụ: xã thuộc về tỉnh cũ đã sáp nhập)

### Ưu tiên3: Postal codes

Tải GeoNames postal codes cho Vietnam (~20,300 records) rồi index riêng hoặc merge vào record hiện có.

---

*Báo cáo tạo ngày 26/08/2026 từ dữ liệu Meilisearch index `places` (470,020 docs) và open-admin-data (v4.0, CC-BY-4.0).*
