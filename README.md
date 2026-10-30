# Lịch họp phòng họp – UBND phường Xuân Hòa

Hiển thị lịch họp trên màn hình trước mỗi phòng họp, chạy trong mạng nội bộ (LAN).
Lịch lấy từ file Excel lịch tuần xuất từ phần mềm quản lý lịch, hoặc nhập/sửa trực tiếp trên trang quản trị.

```
 Máy quản trị (trình duyệt)                 Màn hình trước phòng họp (Android)
   http://<IP máy chủ>:8081/                  Fully Kiosk Browser → http://<IP máy chủ>:8080/room/P201
            │                                            │  tự cập nhật mỗi 60 giây
            └──────────────── mạng LAN ──────────────────┘
                                │
                 Windows Server: LedConference.exe (dịch vụ Windows)
                 data\  ← toàn bộ dữ liệu
```

## 1. Bộ cài gồm

| File | Dùng để |
|---|---|
| `LedConference.exe` | Toàn bộ phần mềm trong một file, đã kèm sẵn .NET – máy chủ **không cần cài gì thêm** |
| `install.bat` | Cài thành dịch vụ Windows: quét cổng, chọn cổng, mở tường lửa, kiểm tra (chạy kèm `install.ps1`) |
| `install.ps1` | Các bước cài đặt mà `install.bat` gọi – phải nằm cạnh `install.bat` |
| `uninstall.bat` | Gỡ dịch vụ sau khi hỏi xác nhận (giữ nguyên dữ liệu) |
| `README.md` | Tài liệu này |
| `screen-api.md` | Mô tả API cho ứng dụng màn hình |

## 2. Yêu cầu máy chủ

- Windows Server 2016 trở lên (hoặc Windows 10/11), 64-bit.
- **IP tĩnh** (hoặc DHCP reservation) – link trên các màn hình trỏ vào IP này.
- Giờ hệ thống đúng (đồng bộ NTP): trạng thái “Đang họp” tính theo giờ máy chủ.
- Hai cổng TCP trống cho màn hình và quản trị (mặc định 8080/8081). `install.bat` tự quét và đề xuất cặp cổng trống.

## 3. Cài đặt

1. Chép cả thư mục bộ cài vào máy chủ, ví dụ `C:\LedConference\`.
2. Chuột phải `install.bat` → **Run as administrator**.
3. **Chọn cổng.** Script quét cổng và in bảng, ví dụ:
   ```
   Kiem tra cong:
     8080   BAN   dang duoc dung boi com.docker.backend (PID 6420)
     8081   TRONG
     8082   TRONG
   De xuat: cong man hinh 8081, cong quan tri 8082
   Cong man hinh (link cho Fully Kiosk / APK) [Enter = 8081]:
   ```
   Bấm Enter để nhận cổng đề xuất, hoặc gõ cổng khác. Cổng sai, trùng nhau hoặc đang bận thì script báo lý do và hỏi lại.
   Script tính cả các dải cổng Windows/Hyper-V/Docker giữ chỗ (trông trống nhưng không mở được).
   Muốn xem trước mà không cài gì: `powershell -ExecutionPolicy Bypass -File install.ps1 -ScanOnly`.
4. Lần đầu, script hỏi **IP các máy được vào trang quản trị**, ví dụ `192.168.1.20, 192.168.1.0/24`.
   **Bỏ trống = mọi máy trong mạng đều vào được** (ghi `0.0.0.0/0`, `::/0` vào `data\settings.json`; thu hẹp sau ở mục 6).
5. Script tự: tạo dịch vụ `LedConference` (tự chạy khi bật máy, tự khởi động lại khi lỗi), cho dịch vụ chạy bằng
   tài khoản quyền thấp riêng, mở tường lửa đúng hai cổng đã chọn, khởi động dịch vụ, **gọi thử cả hai cổng** để chắc
   LedConference đang trả lời, rồi in ra địa chỉ trang quản trị.
6. Từ máy quản trị, mở `http://<IP máy chủ>:<cổng quản trị>/`:
   - tab **Phòng & màn hình → + Thêm phòng** cho từng phòng có màn hình.
   - Kéo thả file lịch tuần vào ô **Nhập lịch tuần**.

Chạy thử không cần cài dịch vụ: bấm đúp `LedConference.exe` (cửa sổ đen là máy chủ; đóng cửa sổ là dừng).

## 4. Cài màn hình (standee Android)

**Cách 1 – ứng dụng riêng `LichHop.apk` (khuyên dùng)**

1. Cắm dây mạng, chép `LichHop.apk` qua USB, bật “Cho phép cài ứng dụng không rõ nguồn”, cài đặt.
2. Mở **Lịch họp**: ứng dụng tự quét mạng LAN tìm máy chủ (cổng 8080, 8088, 8090, 18080, 80).
   Không thấy thì nhập IP máy chủ kèm cổng màn hình, ví dụ `192.168.1.10:8080`, bấm **Kết nối**.
3. Chọn phòng → màn hình bắt đầu chiếu, luôn sáng, toàn màn hình. Lần sau mở máy là chiếu ngay.
4. Đổi phòng/máy chủ: bấm **Back** (remote) hoặc **giữ tay lâu** trên màn hình.
   Màn hình đặt ở **sảnh**: chọn thẻ **Tất cả phòng** – chiếu lần lượt lịch các phòng còn cuộc họp hôm nay.
5. Tự chạy khi bật nguồn: Android 10 trở lên chặn ứng dụng tự mở, nên app hiện hộp **Tự mở khi bật máy** →
   **Mở cài đặt** → bật **Hiển thị trên ứng dụng khác** cho Lịch họp → **Quay lại**. Hộp này hiện mỗi lần mở app cho
   tới khi bật quyền. Bật xong, tắt máy bằng nút nguồn một lần cho Android lưu lại (rút điện ngay có thể mất cài đặt).
   Cách khác: bấm nút Home, chọn **Lịch họp** làm ứng dụng màn hình chính → **Luôn luôn** (khi đó không hỏi nữa).
   Máy của một số hãng (Xiaomi, Oppo…) còn mục **Tự khởi động** riêng trong cài đặt ứng dụng: bật cả mục đó.
6. Màn hình treo **nằm ngang** mà máy không tự xoay: mở menu (Back hoặc giữ tay lâu) → **Xoay màn hình** → chọn góc xoay.
   Lựa chọn lưu riêng trên từng máy, giữ nguyên sau khi tắt mở.

**Cách 2 – Fully Kiosk Browser**

1. Cắm dây mạng, cắm chuột USB, thoát ứng dụng quảng cáo của hãng.
2. Cài **Fully Kiosk Browser** (tải APK từ fully-kiosk.com, chép qua USB, bật “Cho phép cài ứng dụng không rõ nguồn”).
3. Trong Fully Kiosk:
   - **Start URL**: link của phòng (màn hình sảnh: `http://192.168.1.10:8080/lobby`), lấy ở tab **Phòng & màn hình** (dòng “Link Fully Kiosk”, nút **Sao chép**), dạng `http://192.168.1.10:8080/room/P201`.
   - Bật **Launch on Boot**, **Keep Screen On**, **Fullscreen**, **Reload on network reconnect**.
   - Màn hình treo nằm ngang mà máy không tự xoay: thêm `?rotate=90` (hoặc `270`, `180`; theo chiều kim đồng hồ) vào cuối link, ví dụ `http://192.168.1.10:8080/room/P201?rotate=90`.
4. Tắt tự chạy của ứng dụng quảng cáo cũ. Rút điện cắm lại để kiểm tra màn hình tự lên lịch.
5. Nên dùng bản Fully Kiosk PLUS để khoá thiết bị (Kiosk Mode có mã PIN thoát).

**Toà nhà nhiều tầng / nhiều mạng: kiểm tra trước khi treo màn hình**

1. Chép `kiem-tra-mang.bat` + `kiem-tra-mang.ps1` + `huong-dan-mang.md` vào USB. Cắm laptop vào switch của tầng cần kiểm tra (tắt Wi-Fi).
2. Bấm đúp `kiem-tra-mang.bat` → nhập tên tầng, IP máy chủ, 2 cổng (Enter = mặc định). Không cần quyền quản trị.
   Dùng MacBook: thư mục `macos` (`deploy/macos`, trong bộ cài là `dist\macos`), bấm đúp `kiem-tra-mang.command`.
3. Đọc kết quả: dòng **KẾT LUẬN** cho biết standee ở tầng đó chạy được chưa; mỗi dòng `[LỖI]` kèm việc cần sửa (dòng `→`)
   (mở đường/ACL tới máy chủ cổng màn hình, dịch vụ tắt, IP không nằm trong `adminAllow`…). Mục 3 cho biết app có tự tìm
   thấy máy chủ không (cùng dải x.x.x.* với máy chủ) hay phải nhập tay IP trên standee.
4. Cách cấu hình cho từng lỗi (cố định IP máy chủ, VLAN/DHCP, định tuyến và ACL trên Cisco, HPE Aruba, Huawei, MikroTik,
   FortiGate, pfSense…, adminAllow): xem [`docs/huong-dan-mang.md`](docs/huong-dan-mang.md); mỗi dòng lỗi ghi sẵn số mục.
5. Mỗi lần chạy lưu báo cáo vào `ket-qua\` cạnh file, và thêm 1 dòng vào `ket-qua\tong-hop.csv` (mở bằng Excel) để so sánh các tầng.

Standee chỉ cần tới được máy chủ ở **cổng màn hình (TCP)**; máy văn phòng cần thêm **cổng quản trị**. Hệ thống không cần Internet.
Máy chủ nên có **IP cố định** (giữ IP trên DHCP theo MAC hoặc đặt tay), vì standee nhớ IP này.

## 5. Sử dụng hằng ngày

### Nhập lịch tuần từ Excel
Trang quản trị → tab **Nhập Excel** → kéo thả file `Lichdonvi_….xlsx`.
- Lịch các ngày trong tuần của file được **thay mới**; các tuần khác giữ nguyên.
- Nếu tuần đó có cuộc họp đã **sửa tay**, hệ thống hỏi trước khi ghi đè.
- File có lỗi thì **không nhập gì**, danh sách lỗi hiện theo số dòng.
- Địa điểm chưa khớp phòng nào hiện ở mục **Địa điểm chưa gán phòng** – gán vào phòng hoặc bỏ qua.

Quy ước điền file (đúng bố cục file xuất từ phần mềm, có nút **Tải file mẫu**):

| Cột | Nội dung | Ghi chú |
|---|---|---|
| A | Buổi | `Sáng` / `Chiều`. Nhiều cuộc họp một buổi: chèn thêm dòng, cột A để trống |
| B | Giờ | `08:00`, `8h30`, `08:00 - 10:00`. Trống = giờ đầu buổi |
| C | Nội dung | **Bắt buộc**. Dòng trống cột C = không có họp |
| D, E | Chủ trì, Thành phần | |
| F | Địa điểm | **Bắt buộc**. Dùng để chia lịch cho từng phòng |
| G | Ghi chú | Bắt đầu bằng “Hoãn” = cuộc họp bị hoãn |

Không ghi giờ kết thúc: hệ thống lấy giờ bắt đầu của cuộc họp kế tiếp cùng địa điểm, tối đa đến hết buổi
(mặc định Sáng 07:30–11:30, Chiều 13:30–17:30, chỉnh ở **Giờ mặc định theo buổi**).

### Sửa lịch trực tiếp
Trang quản trị → **Lịch họp**: lọc theo phòng, chọn tuần, **+ Thêm cuộc họp**, **Sửa**, **Xoá**,
đặt trạng thái Hoãn (màn hình hiện “ĐÃ HOÃN”) hoặc Huỷ (ẩn khỏi màn hình). Màn hình cập nhật trong vòng 1 phút.

### Giao diện
- **Giao diện màn hình (cấu hình chung)**: mẫu Chính thức / Trang trọng / Hiện đại, hiệu ứng, màn hình dọc/ngang,
  hình đường chân trời, đồng hồ, chân trang, ghi chú cố định.
- Từng phòng có thể dùng giao diện riêng: tab **Phòng & màn hình** → **Sửa & xem trước** (có khung xem trước màn hình thật).
- Tab **Phòng & màn hình** cho biết màn hình nào đang chạy (chấm xanh) hay mất kết nối quá 3 phút (chấm đỏ), kèm IP thiết bị.
- **Chỉnh màu từng mẫu, tạo mẫu mới**: lưu vào `data\themes.json`.
- Logo phường có sẵn; muốn đổi: **Đơn vị & logo → Đổi logo** (WebP/PNG/JPG, tối đa 2MB).

## 6. Cấu hình trong file (`data\settings.json`)

Sửa bằng Notepad trên máy chủ, sau đó **khởi động lại dịch vụ** (Services → LedConference → Restart):

```json
{
  "screenPort": 8080,
  "adminPort": 8081,
  "adminAllow": ["192.168.1.20", "192.168.1.0/24"]
}
```

- `adminAllow`: máy/dải IP được vào trang quản trị. Máy chủ luôn vào được. `["0.0.0.0/0", "::/0"]` = mọi máy;
  `[]` = chỉ máy chủ. Trang quản trị **không có đăng nhập** – ai ngồi ở máy trong danh sách đều sửa được lịch;
  nhật ký ghi lại máy nào sửa gì.
- Đổi cổng: chạy lại `install.bat` – script hỏi lại cổng, sửa `screenPort`/`adminPort` trong file này (các mục khác
  giữ nguyên), mở tường lửa đúng cổng mới. Sau đó cập nhật link trên các màn hình nếu đổi cổng màn hình.
- `data\themes.json` (màu các mẫu) sửa tay được, **không cần khởi động lại**: máy chủ tự nạp. File sai thì giữ mẫu cũ
  và báo lỗi trên trang quản trị.
- `adminHosts`: tên miền được mở trang quản trị, ngoài IP, `localhost` và tên máy chủ. Dùng khi đưa trang quản trị
  ra Internet qua Cloudflare Tunnel, ví dụ `"adminHosts": ["schedule.xuanhoa.io.vn"]`. Tên miền khác bị chặn.

### Quản trị từ xa qua Cloudflare Tunnel (chỉ cổng quản trị; cổng màn hình giữ nội bộ)

1. Cloudflare Zero Trust → **Networks → Tunnels** → tunnel trên máy chủ → **Public Hostname** → thêm
   `schedule.xuanhoa.io.vn`, Type **HTTP**, URL **`127.0.0.1:<adminPort>`** (ghi IP, không ghi `localhost`).
   **Không** thêm hostname cho cổng màn hình.
2. **Bắt buộc**: Zero Trust → **Access → Applications → Self-hosted** cho `schedule.xuanhoa.io.vn`, policy chỉ cho
   email người quản trị (One-time PIN). Trang quản trị không có đăng nhập; Access là lớp đăng nhập.
3. Thêm hostname vào `adminHosts` và mục `access` vào `data\settings.json`, khởi động lại dịch vụ:

   ```json
   "adminHosts": ["schedule.xuanhoa.io.vn"],
   "access": { "teamDomain": "<team>.cloudflareaccess.com", "aud": "<Application Audience (AUD) Tag>" }
   ```

   `teamDomain`: Zero Trust → Settings → Custom Pages (hoặc phần đầu link trang đăng nhập Access). `aud`: Access →
   Applications → ứng dụng → Overview → **Application Audience (AUD) Tag**.
4. Máy chủ **tự kiểm tra vé đăng nhập Access** (`Cf-Access-Jwt-Assertion`, chữ ký RS256 bằng khoá của team, đúng
   AUD, còn hạn) với mọi yêu cầu qua tunnel. Thiếu hoặc sai vé → 403, kể cả khi hostname bị publish nhầm không có
   Access. Chưa có mục `access` → không nhận truy cập qua tunnel. Qua tunnel không xét `adminAllow` (người quản trị
   ở xa đổi IP liên tục), nên `adminAllow` chỉ còn dùng cho mạng LAN: thu hẹp về các máy quản trị trong LAN.
   Nhật ký ghi IP thật kèm email đăng nhập.
5. Từ xa: xem trước màn hình vẫn chạy (lấy qua cổng quản trị); link màn hình luôn là IP LAN của máy chủ, chỉ dùng
   được trong mạng nội bộ.

## 7. Dữ liệu, sao lưu, khôi phục

Mọi dữ liệu nằm trong `data\` cạnh `LedConference.exe`:

| File / thư mục | Nội dung |
|---|---|
| `meetings.json` | Toàn bộ cuộc họp |
| `rooms.json` | Phòng, địa điểm khớp, giao diện riêng |
| `settings.json`, `themes.json` | Cấu hình, các mẫu giao diện |
| `imports\` | File Excel gốc của từng lần nhập |
| `backup\` | Bản sao `meetings.json` mỗi ngày, giữ theo `retentionDays` (mặc định 30 ngày) |
| `audit.log` | Nhật ký thao tác (lúc nào, máy nào, làm gì) |
| `logo.*` | Logo đã đổi (nếu có) |

- **Tự xoá dữ liệu cũ**: lúc khởi động và mỗi 12 giờ, máy chủ xoá cuộc họp có ngày họp cũ hơn `retentionDays` ngày
  (mặc định 30, trong `data\settings.json`), file Excel đã nhập và dòng nhật ký cũ hơn mốc đó, cùng bản sao lưu cũ.
  Mỗi lần xoá được ghi vào nhật ký (“Tự xoá dữ liệu cũ”). Đặt `"retentionDays": 0` để giữ mãi; đổi số này xong phải
  khởi động lại dịch vụ.
- **Sao lưu**: copy cả thư mục `data\` (có thể copy khi dịch vụ đang chạy). Muốn giữ lịch họp lâu hơn 30 ngày thì
  tăng `retentionDays` hoặc sao lưu `data\` định kỳ ra chỗ khác.
- **Khôi phục lịch về một ngày trước**: dừng dịch vụ, chép `backup\meetings-YYYYMMDD.json` đè lên `meetings.json`,
  khởi động lại.

## 8. Cập nhật phiên bản mới

1. Services → **LedConference** → Stop (hoặc `sc stop LedConference`).
2. Chép `LedConference.exe` mới đè lên file cũ. **Không xoá thư mục `data\`.**
3. Start dịch vụ. Không cần chạy lại `install.bat`.

## 9. Gỡ cài đặt

Chuột phải `uninstall.bat` → Run as administrator. Dịch vụ và luật tường lửa bị gỡ, `data\` được giữ lại.

## 10. Bảo mật mạng (khuyến nghị cho bộ phận IT)

- Đặt các màn hình vào **VLAN riêng**, chỉ cho phép đi tới máy chủ cổng 8080.
- **Khoá cổng switch** nối với standee theo MAC, tắt cổng không dùng (tránh cắm laptop lạ vào cổng LAN của standee).
- Tường lửa máy chủ: có thể thu hẹp luật “LedConference - quản trị” chỉ cho dải IP các máy quản trị.
- Cổng 8080 chỉ đọc, chỉ trả lịch hôm nay của từng phòng; cổng 8081 chặn máy ngoài danh sách `adminAllow`.
- Dịch vụ chạy bằng tài khoản riêng quyền thấp (`NT SERVICE\LedConference`), chỉ ghi được vào `data\`,
  không kết nối ra Internet.

## 11. Xử lý sự cố

| Hiện tượng | Kiểm tra |
|---|---|
| `install.bat` báo dịch vụ chưa chạy | Event Viewer → Windows Logs → Application, nguồn **LedConference** hoặc **.NET Runtime** (lỗi lúc khởi động). Thường do cổng đã bị dùng, hoặc giá trị sai trong `adminAllow` – thông báo ghi rõ giá trị nào. Cách nhanh nhất để xem lỗi: bấm đúp `LedConference.exe` |
| Trang quản trị báo “Không có quyền” | IP máy đó chưa có trong `adminAllow` (trang báo luôn IP đang dùng) |
| Không mở được trang từ máy khác | Tường lửa / VLAN; thử `http://<IP>:8080/room/<mã>` từ máy đó |
| Màn hình hiện “Mất kết nối” | Dây mạng / máy chủ tắt; màn hình vẫn giữ lịch tải lần cuối và tự kết nối lại |
| Màn hình hiện “Không có phòng …” | Mã phòng trong link sai hoặc phòng đã bị xoá |
| Lịch không hiện cho một phòng | Địa điểm trong Excel chưa gán phòng → mục **Địa điểm chưa gán phòng** |
| Sai giờ “Đang họp” | Giờ hệ thống máy chủ (đồng bộ NTP, múi giờ UTC+7) |

## 12. Dành cho người phát triển

```
src\LedConference\   máy chủ (.NET 10, ASP.NET Core Minimal API)
  Program.cs          điểm ghép: đọc cấu hình, đăng ký dịch vụ (DI), middleware, gọi từng nhóm API
  Domain\             mô hình dữ liệu, mẫu giao diện, luật kiểm tra dữ liệu nhập, chọn cuộc họp đang/tiếp theo
  Storage\            Store (lưu JSON an toàn, sao lưu), AuditLog (nhật ký), cấu hình JSON
  Excel\              WeekExcelReader (đọc file lịch tuần), WeekExcelWriter (xuất, file mẫu)
  Http\               ServerConfig (cổng, IP quản trị), PortGate (tách cổng, chặn IP/Origin, header bảo mật),
                      EmbeddedAssets (file nhúng trong exe), Api (trả lỗi, IP, mã, diff)
  Services\           ScreenStatus (màn hình đang chạy), LogoFiles, ThemeWatcher, RetentionCleanup (chạy nền)
  Endpoints\          mỗi nhóm API một file (Screen, Room, Meeting, Excel, Place, Settings, Theme, Logo, Page) + Views
  web\                các trang, nhúng vào exe:
    admin.js          trang quản trị (module ES): gắn từng trang vào route
    admin-core.js     khung chung: h(), gọi API, thông báo, ngày giờ, form, điều hướng
    admin-pickers.js  chọn ngày dd/mm/yyyy, giờ 24h
    admin-schedule/import/rooms/appearance/themes/system.js   mỗi tab một module
    display.*, schedule.js   trang màn hình phòng / sảnh (script thường, chạy được trên WebView cũ)
    logo.webp, skyline.webp  logo, hình đường chân trời
tests\SelfCheck\      kiểm tra tự động (chạy: dotnet run --project tests\SelfCheck)
tests\schedule.test.js  kiểm tra chọn trạng thái màn hình và xoay phòng sảnh (node tests\schedule.test.js)
tests\api-snapshot.ps1  chụp lại kết quả của mọi API để so sánh trước/sau khi sửa code (xem đầu file)
deploy\               install.bat (+ install.ps1), uninstall.bat
docs\screen-api.md    API cho ứng dụng màn hình
demo\                 bản mẫu HTML chạy bằng dữ liệu giả (mock.js); chạy demo\make-demo.ps1 để tạo demo\site\
image\                ảnh gốc của bộ nhận diện (PNG) và bản WebP
build.bat             chạy SelfCheck rồi đóng gói ra dist\
```

Cần .NET 10 SDK trên máy build. Chạy `build.bat` → thư mục `dist\` là bộ cài.
