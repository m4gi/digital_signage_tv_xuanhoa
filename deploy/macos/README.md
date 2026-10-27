# Kiểm tra mạng trên MacBook

Bản macOS của `kiem-tra-mang.bat`: cùng các bước kiểm tra, cùng báo cáo. Không cần quyền quản trị, không cần cài thêm gì.

## Chạy

1. Chép cả thư mục `macos` (và `huong-dan-mang.md`) vào USB hoặc vào máy Mac.
2. Cắm Mac vào switch của tầng cần kiểm tra (qua cổng mạng hoặc bộ chuyển USB‑LAN). **Tắt Wi‑Fi** để chắc chắn đang đi qua dây.
3. Bấm đúp `kiem-tra-mang.command` → Terminal mở ra, nhập tên tầng, IP máy chủ, 2 cổng (Enter = mặc định).

Lần đầu macOS có thể chặn file tải về: **chuột phải vào file → Open → Open**. Nếu báo “không có quyền chạy”, mở Terminal và gõ:

```bash
bash ~/Downloads/macos/kiem-tra-mang.command
```

(kéo file vào cửa sổ Terminal để khỏi gõ đường dẫn). Chạy không cần hỏi:

```bash
bash kiem-tra-mang.command --tang "Tầng 3" --server 10.188.44.67 --screen-port 8081 --admin-port 8082
```

## Kết quả

- Màn hình in **[ĐẠT] / [LỖI]** từng bước, kèm cách xử lý; dòng cuối là KẾT LUẬN cho standee ở tầng đó.
- Báo cáo lưu trong `ket-qua/<tầng>_<giờ>.txt` cạnh file script.
- Mỗi lần chạy thêm 1 dòng vào `ket-qua/tong-hop.csv`, cùng cột với bộ Windows: có thể chép các dòng của hai bộ vào một bảng, mở bằng Excel hoặc Numbers.

Báo LỖI ở bước nào thì làm theo mục tương ứng trong `huong-dan-mang.md`. Các lệnh trên **máy chủ** trong đó (`Get-Service`, `Restart-Service`, `data\settings.json`) vẫn là lệnh Windows, vì máy chủ chạy Windows.
