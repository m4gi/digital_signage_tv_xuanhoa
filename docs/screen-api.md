# API cho màn hình (cổng 8080)

Hợp đồng giữa máy chủ và ứng dụng màn hình (APK hoặc trang `/room/{mã}`).
Cổng này chỉ đọc, không cần đăng nhập, cho phép gọi từ mọi nguồn (CORS `*`, không cookie).

`apiVersion` hiện là **1**. Máy chủ chỉ tăng số này khi đổi API theo cách làm app cũ hỏng
(bỏ hoặc đổi nghĩa một trường). Thêm trường mới không tăng `apiVersion`; app phải bỏ qua trường lạ.

## `GET /api/screens/{mã phòng}`

Gọi mỗi 30 giây. Header trả về có `Cache-Control: no-store`.

| Mã | Khi nào |
|---|---|
| 200 | Dữ liệu bên dưới |
| 404 | Không có phòng (ProblemDetails, `title` = "Không tìm thấy phòng") |

```json
{
  "apiVersion": 1,
  "room": { "code": "P201", "name": "Phòng họp tầng 2" },
  "org": { "line1": "ỦY BAN NHÂN DÂN", "line2": "PHƯỜNG XUÂN HÒA", "logoUrl": "/logo?v=3", "customLogo": false },
  "serverTime": "2026-10-22T08:42:15",
  "week": { "from": "2026-10-19", "to": "2026-10-25" },
  "configVersion": "c7f1a2b0",
  "display": {
    "orientation": "auto",
    "effect": "fadeUp",
    "clock": true,
    "footer": true,
    "reduceMotion": false,
    "hideCursor": true,
    "footerNote": "Đề nghị tắt chuông điện thoại khi vào phòng họp",
    "emptyDay": "nextMeeting",
    "skyline": "normal",
    "contact": "Văn phòng HĐND – UBND phường",
    "theme": {
      "id": "official", "name": "Chính thức", "bgAngle": 180,
      "bg1": "#D0EDFF", "bg2": "#8ACAFF", "ink": "#0B2545", "muted": "#2A4A73",
      "accent": "#FFC72C", "onAccent": "#0B2545",
      "card": "rgba(255,255,255,.62)", "cardBorder": "rgba(255,255,255,.95)",
      "person": "#0A3D82", "label": "#7A5600", "num": "#0C4DA2",
      "dot": "#0B2545", "dotOpacity": 0.04,
      "skyline": "#FFFFFF", "skylineOpacity": 0.4, "skylineStrongOpacity": 0.7
    }
  },
  "current": {
    "id": "m_8f3k2", "date": "2026-10-22", "start": "08:00", "end": "09:30", "endEstimated": false,
    "title": "Giao ban tuần", "chair": "Chủ tịch UBND phường",
    "participants": "Lãnh đạo UBND", "note": "", "status": "normal"
  },
  "upcoming": [],
  "next": null
}
```

### Các trường

- `serverTime`: giờ máy chủ, **không có múi giờ**. Đọc như giờ địa phương (đừng parse như UTC),
  lấy chênh lệch với đồng hồ thiết bị rồi chạy đồng hồ theo chênh lệch đó.
- `configVersion`: đổi khi cấu hình hiển thị, theme, tên đơn vị hoặc logo đổi. Chỉ cần áp lại giao diện khi số này đổi.
- `org.logoUrl`: luôn có (logo phường nhúng sẵn trong phần mềm, hoặc logo đã upload khi `customLogo` = true).
  Đường dẫn tương đối với máy chủ; số `v` đổi mỗi lần upload.
- `display.skyline`: `normal` | `strong` | `off`. Hình đường chân trời của phường lấy từ `/assets/skyline.webp`
  (nền trong suốt, 1920×831), dùng làm mask tô màu `theme.skyline` với độ đậm `skylineOpacity`
  (hoặc `skylineStrongOpacity` khi `strong`), canh đáy, phủ toàn chiều rộng, nằm dưới nội dung.
- `display.orientation`: `auto` (tự theo khung hình) | `portrait` | `landscape`.
- `display.effect`: `fadeUp` | `zoom` | `slideLeft` | `shine` | `border`. Bỏ qua khi `reduceMotion` = true.
- `display.contact`: nội dung dòng “Liên hệ: …” (dưới Ghi chú khi đang họp, dưới cuộc họp tiếp theo khi phòng trống).
  Chuỗi rỗng = không hiện (đã tắt trong cấu hình hoặc chưa nhập nội dung).
- `display.emptyDay`: `nextMeeting` (hết lịch hôm nay thì hiện cuộc họp gần nhất ngày sau) | `free`.
- `display.theme`: mọi màu dạng `#RRGGBB`, riêng `card` và `cardBorder` có thể là `rgba(r,g,b,a)`.
  Nền = gradient `bg1 → bg2` theo góc `bgAngle`, phủ lớp chấm tròn màu `dot` độ đậm `dotOpacity`, lưới 36px.
- Cuộc họp: `start`/`end` dạng `HH:mm`. `endEstimated` = true khi giờ kết thúc do máy chủ tự tính.
  `status`: `normal` | `postponed` (hiện nhãn "ĐÃ HOÃN"). Cuộc họp huỷ không bao giờ có trong kết quả.
- `current`: cuộc họp đang diễn ra (`start` ≤ bây giờ < `end`), hoặc `null` khi phòng trống.
- `upcoming`: phần còn lại của hôm nay chưa kết thúc, theo giờ bắt đầu.
- `next`: cuộc họp đầu tiên của ngày sau; chỉ có khi hôm nay không còn gì và `emptyDay` = `nextMeeting`.

## `GET /logo?v=N`

Logo phường (WebP, PNG hoặc JPG). Được cache 1 ngày; `v` đổi khi logo đổi.

## `GET /assets/skyline.webp`

Hình đường chân trời dùng làm mask (xem `display.skyline`).

## Chưa có (giai đoạn APK)

- Header `X-Device-Key` để chỉ thiết bị đã duyệt mới lấy được lịch (CORS đã cho phép header này).
- `POST /api/devices/heartbeat` để báo thiết bị online và nhận lệnh từ xa.
