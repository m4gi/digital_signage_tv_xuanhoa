# Hướng dẫn cấu hình mạng cho hệ thống lịch họp

Dùng kèm bộ kiểm tra `kiem-tra-mang.bat`: chạy ở tầng nào báo **[LỖI]** thì làm theo mục tương ứng, rồi chạy lại cho đến khi
**KẾT LUẬN: CHẠY ĐƯỢC**.

Số liệu mẫu bên dưới lấy theo máy chủ hiện tại, thay cho đúng mạng của bạn:

| | Giá trị mẫu |
|---|---|
| Máy chủ lịch họp | `10.188.44.67`, mask `255.255.255.192` (/26), gateway `10.188.44.65`, MAC `30-C5-99-62-E5-09` |
| Cổng màn hình (standee cần) | TCP `8081` |
| Cổng quản trị (máy văn phòng cần) | TCP `8082` |
| Mạng của một tầng khác (ví dụ) | `10.188.45.0/26` |

Chỉ cần **một chiều**: từ các tầng **tới** máy chủ. Máy chủ không chủ động gọi tới standee, không cần Internet.

## Bộ kiểm tra báo gì → đọc mục nào

| Dòng [LỖI] trong bộ kiểm tra | Nguyên nhân thường gặp | Mục |
|---|---|---|
| `Có IP` (IP 169.254.x.x) hoặc `Có gateway` | Cổng switch sai VLAN, tầng chưa có DHCP | [2](#2-standee-hoặc-laptop-không-nhận-được-ip) |
| `Kết nối TCP 8081`: **máy đích từ chối** | Mạng đã thông, nhưng dịch vụ tắt / sai cổng / tường lửa Windows | [3](#3-máy-đích-từ-chối-kiểm-tra-máy-chủ) |
| `Kết nối TCP 8081`: **hết thời gian chờ** | Chưa có định tuyến giữa các tầng hoặc bị ACL / firewall chặn | [4](#4-hết-thời-gian-chờ-mở-đường-giữa-các-tầng) |
| `Được phép vào trang quản trị`: bị chặn | IP của tầng không nằm trong `adminAllow` | [5](#5-không-vào-được-trang-quản-trị-adminallow) |
| `Tự tìm: KHÔNG` (không phải lỗi) | Standee khác dải với máy chủ | [6](#6-app-không-tự-tìm-thấy-máy-chủ) |

Trước hết nên làm [mục 1](#1-cố-định-ip-máy-chủ-làm-một-lần): máy chủ đổi IP là mọi standee mất kết nối.

---

## 1. Cố định IP máy chủ (làm một lần)

Chọn **một** trong hai cách.

### Cách A – Giữ IP trên DHCP (khuyên dùng)
Làm trên thiết bị đang cấp DHCP cho dải của máy chủ (xem `Gateway`/`DHCP` ở bộ kiểm tra):

**Windows Server (DHCP Server)** – PowerShell quản trị trên máy DHCP:
```powershell
Add-DhcpServerv4Reservation -ScopeId 10.188.44.64 -IPAddress 10.188.44.67 -ClientId 30-C5-99-62-E5-09 -Description "May chu lich hop"
```

**Cisco IOS** (switch/router đang cấp DHCP):
```
conf t
ip dhcp pool LICHHOP-SERVER
 host 10.188.44.67 255.255.255.192
 client-identifier 0130.c599.62e5.09
 default-router 10.188.44.65
 dns-server 202.78.224.129 202.78.224.130
end
write memory
```
(`client-identifier` = `01` + MAC.)

**MikroTik RouterOS:**
```
/ip dhcp-server lease add address=10.188.44.67 mac-address=30:C5:99:62:E5:09 comment="May chu lich hop"
```
(Nếu lease đang có sẵn: IP > DHCP Server > Leases > chọn dòng của máy chủ > **Make Static**.)

**FortiGate:**
```
config system dhcp server
    edit <số thứ tự DHCP server của dải máy chủ>
        config reserved-address
            edit 0
                set ip 10.188.44.67
                set mac 30:c5:99:62:e5:09
            next
        end
    next
end
```

**pfSense / OPNsense:** Services > DHCP Server > (interface) > **Static Mappings** > Add: MAC `30:c5:99:62:e5:09`, IP `10.188.44.67`.

Thiết bị khác (TP-Link Omada, DrayTek, Ubiquiti…): tìm mục **DHCP Reservation / Address Reservation / Static Lease**, nhập MAC và IP như trên.

Xong thì trên máy chủ chạy `ipconfig /renew` (hoặc khởi động lại) và kiểm tra IP vẫn là `10.188.44.67`.

### Cách B – Đặt tay trên máy chủ
Settings > Network & Internet > **Ethernet** > IP assignment > **Edit** > **Manual** > bật IPv4:
IP `10.188.44.67`, Subnet mask `255.255.255.192`, Gateway `10.188.44.65`, DNS `202.78.224.129` / `202.78.224.130`.

Sau đó **loại `10.188.44.67` khỏi vùng cấp phát DHCP** (exclusion) để không bị trùng IP.

---

## 2. Standee hoặc laptop không nhận được IP

Bộ kiểm tra báo `IP 169.254.x.x` hoặc không có gateway.

1. Kiểm tra dây và đèn cổng switch.
2. Cổng switch phải thuộc đúng VLAN có DHCP của tầng đó (access port):

   **Cisco:**
   ```
   conf t
   interface GigabitEthernet1/0/10
    switchport mode access
    switchport access vlan 30
    spanning-tree portfast
   end
   ```
   **HPE Aruba (AOS-S):** `vlan 30 untagged 10`
   **Huawei:** `interface GigabitEthernet0/0/10` → `port link-type access` → `port default vlan 30`
3. VLAN đó phải có DHCP: hoặc có DHCP server trên chính thiết bị định tuyến, hoặc có **DHCP relay** về máy DHCP chung
   (Cisco: `interface vlan 30` → `ip helper-address <IP máy DHCP>`).

---

## 3. "Máy đích từ chối": kiểm tra máy chủ

Mạng đã thông tới máy chủ, nhưng cổng không mở. Trên **máy chủ**, PowerShell:
```powershell
Get-Service LedConference
Get-NetTCPConnection -State Listen -LocalPort 8081,8082
Get-NetFirewallRule -DisplayName 'LedConference*' | Select-Object DisplayName, Enabled, Profile
```
- Dịch vụ **Stopped** → `Start-Service LedConference` (PowerShell quản trị). Không chạy được thì xem Event Viewer > Windows Logs > Application, nguồn `LedConference`.
- Không thấy cổng 8081/8082 đang Listen → cổng trong `dist\data\settings.json` khác với cổng bạn đang test. Dùng đúng cổng, hoặc chạy lại `install.bat` để đổi cổng.
- Không có rule tường lửa hoặc `Enabled = False` → chạy lại `install.bat` (tự tạo lại rule), hoặc:
  ```powershell
  New-NetFirewallRule -DisplayName 'LedConference - man hinh' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8081
  New-NetFirewallRule -DisplayName 'LedConference - quan tri' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8082
  ```
- Có phần mềm diệt virus / tường lửa riêng (Kaspersky, ESET…) → thêm ngoại lệ cho `LedConference.exe` hoặc cổng 8081–8082.

---

## 4. "Hết thời gian chờ": mở đường giữa các tầng

Gói tin từ tầng không tới được máy chủ. Việc làm trên **thiết bị định tuyến giữa các tầng**: bộ kiểm tra in ở mục 4
(`Thiết bị định tuyến đầu tiên`), nếu `tracert` bị chặn thì đó là **gateway của tầng**.

Cần đủ 2 điều:
- **(a) Có định tuyến** giữa dải của tầng và dải của máy chủ.
- **(b) Không bị chặn**: ACL / chính sách firewall cho phép `<dải tầng>` → `10.188.44.67` TCP `8081` (và `8082` nếu tầng có máy quản trị).

> **Cẩn thận với ACL:** chỉ **thêm dòng permit** vào ACL đang có. Đừng gắn một ACL mới lên interface nếu chưa hiểu
> hết các dòng: ACL có "deny tất cả" ngầm ở cuối, gắn nhầm là cắt mạng cả tầng.

### Cisco Catalyst (switch lõi L3)
```
conf t
ip routing
! Mỗi tầng một SVI làm gateway (thường đã có sẵn):
interface vlan 30
 ip address 10.188.45.1 255.255.255.192
 no shutdown
end
show ip route
```
Nếu interface của tầng đang gắn ACL (`show running-config interface vlan 30` thấy `ip access-group ... in`):
```
conf t
ip access-list extended <TÊN-ACL-ĐANG-GẮN>
 1 permit tcp 10.188.45.0 0.0.0.63 host 10.188.44.67 eq 8081
 2 permit tcp 10.188.45.0 0.0.0.63 host 10.188.44.67 eq 8082
end
write memory
```
(`1`, `2` = chèn lên đầu ACL; `0.0.0.63` là wildcard của /26.)

### HPE Aruba (AOS-S)
```
conf
ip routing
vlan 30 ip address 10.188.45.1 255.255.255.192
show ip route
```
ACL: thêm `permit tcp 10.188.45.0 0.0.0.63 host 10.188.44.67 eq 8081` vào ACL đang gắn lên VLAN 30 (`show running-config vlan 30`).

### Huawei (VRP)
```
system-view
interface Vlanif30
 ip address 10.188.45.1 26
quit
display ip routing-table
```
Nếu có `traffic-filter` trên Vlanif/cổng: thêm rule permit TCP tới `10.188.44.67` cổng 8081 vào ACL đó.

### MikroTik RouterOS
Định tuyến giữa các mạng gắn trực tiếp đã có sẵn; thường chỉ bị chặn ở firewall:
```
/ip firewall filter add chain=forward src-address=10.188.45.0/26 dst-address=10.188.44.67 protocol=tcp dst-port=8081,8082 action=accept comment="Lich hop" place-before=0
```

### FortiGate
```
config firewall address
    edit "LichHop-Server"
        set subnet 10.188.44.67 255.255.255.255
    next
    edit "Tang3-Net"
        set subnet 10.188.45.0 255.255.255.192
    next
end
config firewall service custom
    edit "LichHop-8081-8082"
        set tcp-portrange 8081-8082
    next
end
config firewall policy
    edit 0
        set name "Tang3-to-LichHop"
        set srcintf "<interface/VLAN của tầng 3>"
        set dstintf "<interface/VLAN của máy chủ>"
        set srcaddr "Tang3-Net"
        set dstaddr "LichHop-Server"
        set action accept
        set schedule "always"
        set service "LichHop-8081-8082"
        set nat disable
    next
end
```
Policy mới nằm cuối danh sách: nếu phía trên có policy deny trùng thì kéo policy này lên trên (`move <id> before <id>`).

### pfSense / OPNsense
Firewall > Rules > tab **interface của tầng** > Add: Action **Pass**, Protocol **TCP**, Source **(dải tầng) net**,
Destination **Single host** `10.188.44.67`, Port range `8081`–`8082` > Save > **Apply Changes**.

### Thiết bị khác (TP-Link Omada, DrayTek, Ubiquiti…)
Tìm mục **Inter-VLAN Routing** (bật), rồi **ACL / Firewall Rules / Access Control**: thêm rule cho phép dải tầng → `10.188.44.67`, TCP 8081–8082.

### Cách khác: VLAN riêng cho màn hình
Thay vì mở từng tầng, tạo 1 VLAN "màn hình" (ví dụ VLAN 50, dải `/24`), kéo trunk tới switch các tầng, cắm standee vào
cổng access VLAN 50, và cho máy chủ một chân trong VLAN 50 (card thứ hai hoặc sub-interface). Khi đó app **tự tìm** được
máy chủ và không phải mở luật giữa các tầng.

---

## 5. Không vào được trang quản trị (adminAllow)

Bộ kiểm tra báo `bị chặn: IP ... không nằm trong adminAllow`. Trên **máy chủ** sửa
`C:\Data\Source\Led_Conference\dist\data\settings.json` (hoặc thư mục `data\` cạnh `LedConference.exe` nơi đã cài):
```json
"adminAllow": ["10.188.44.64/26", "10.188.45.0/26"],
```
Mỗi dải văn phòng một dòng; `["0.0.0.0/0", "::/0"]` = mọi máy. Sau đó PowerShell quản trị:
```powershell
Restart-Service LedConference
```
Ngay trên máy chủ (`http://localhost:8082/`) luôn vào được, nên sửa sai cũng không bị khoá ngoài.

---

## 6. App không tự tìm thấy máy chủ

Không phải lỗi: app chỉ quét dải `x.x.x.*` của chính standee. Trên standee, ở ô **Nhập địa chỉ máy chủ** gõ
`10.188.44.67:8081` → **Kết nối** → chọn phòng (hoặc **Tất cả phòng** cho màn hình sảnh). Chỉ làm một lần, app nhớ lại.

---

## Kiểm tra lại
Sau mỗi thay đổi, chạy lại `kiem-tra-mang.bat` ở tầng đó. Khi đủ các tầng, mở `ket-qua\tong-hop.csv` bằng Excel để
xem cả toà nhà trong một bảng.
