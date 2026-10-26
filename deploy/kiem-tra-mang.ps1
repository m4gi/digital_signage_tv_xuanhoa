# Network test for one floor: run on a laptop plugged into that floor's switch (no admin rights needed).
# Checks what a screen (standee) and an admin PC need: an address on this floor, a route to the server,
# the screen port (lịch + màn hình sảnh), the admin port, and whether the app can find the server by itself.
# Prints PASS/FAIL with what to fix, saves a report in ket-qua\ next to this file and adds a line to
# ket-qua\tong-hop.csv so every floor ends up in one table.
#   kiem-tra-mang.bat                       asks floor name and server (Enter = defaults)
#   kiem-tra-mang.ps1 -Tang "Tầng 3" -Server 10.188.44.67 -ScreenPort 8081 -AdminPort 8082
# Saved as UTF-8 WITH BOM: Windows PowerShell 5 reads a file without BOM as ANSI and breaks the Vietnamese text.
param(
    [string]$Tang = '',
    [string]$Server = '',
    [int]$ScreenPort = 0,
    [int]$AdminPort = 0
)
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$DefaultServer = '10.188.44.67'
$DefaultScreen = 8081
$DefaultAdmin = 8082

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }
$lines = New-Object System.Collections.Generic.List[string]
function Note([string]$text) { $lines.Add($text) }
$results = [ordered]@{}
function Result([string]$key, [bool]$ok, [string]$label, [string]$detail, [string]$fix) {
    $results[$key] = $ok
    $mark = if ($ok) { 'ĐẠT' } else { 'LỖI' }
    Say ("  [{0}] {1}: {2}" -f $mark, $label, $detail) $(if ($ok) { 'Green' } else { 'Red' })
    Note ("[{0}] {1}: {2}" -f $mark, $label, $detail)
    if (-not $ok -and $fix) { Say "        → $fix" Yellow; Note "      → $fix" }
}
function Info([string]$label, [string]$detail) { Say "  [i] ${label}: $detail" Cyan; Note "[i] ${label}: $detail" }

function Ask([string]$label, [string]$default) {
    $a = Read-Host "$label [Enter = $default]"
    if ([string]::IsNullOrWhiteSpace($a)) { $default } else { $a.Trim() }
}

# TCP connect with a short timeout (Test-NetConnection waits ~20s on a blocked port).
function Test-Tcp([string]$hostName, [int]$port, [int]$ms = 3000) {
    $c = New-Object System.Net.Sockets.TcpClient
    try {
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $ar = $c.BeginConnect($hostName, $port, $null, $null)
        if (-not $ar.AsyncWaitHandle.WaitOne($ms)) { return @{ Ok = $false; Why = "hết thời gian chờ ($ms ms): gói tin bị chặn hoặc không có đường đi" } }
        $c.EndConnect($ar)
        return @{ Ok = $true; Ms = $sw.ElapsedMilliseconds }
    } catch {
        $m = $_.Exception.InnerException; if (-not $m) { $m = $_.Exception }
        if ($m.Message -match 'actively refused|từ chối|tu choi') { return @{ Ok = $false; Refused = $true; Why = 'máy đích từ chối: tới được máy nhưng cổng đang đóng' } }
        return @{ Ok = $false; Why = $m.Message }
    } finally { $c.Close() }
}

# GET with a timeout; returns the status code (also 4xx/5xx) and the body read as UTF-8.
function Get-Http([string]$url) {
    try {
        $req = [Net.HttpWebRequest]::Create($url)
        $req.Timeout = 5000
        $req.ReadWriteTimeout = 5000
        $sw = [Diagnostics.Stopwatch]::StartNew()
        try { $res = $req.GetResponse() } catch [Net.WebException] { $res = $_.Exception.Response; if (-not $res) { throw } }
        $reader = New-Object IO.StreamReader($res.GetResponseStream(), [Text.Encoding]::UTF8)
        $body = $reader.ReadToEnd()
        $reader.Close()
        $code = [int]$res.StatusCode
        $res.Close()
        return @{ Code = $code; Body = $body; Ms = $sw.ElapsedMilliseconds }
    } catch {
        $m = $_.Exception.InnerException; if (-not $m) { $m = $_.Exception }
        return @{ Code = 0; Body = ''; Why = $m.Message }
    }
}

function Prefix-To-Mask([int]$p) {
    $bits = ('1' * $p).PadRight(32, '0')
    (0..3 | ForEach-Object { [Convert]::ToInt32($bits.Substring($_ * 8, 8), 2) }) -join '.'
}
function Same-Net([string]$a, [string]$b, [int]$prefix) {
    $x = [Net.IPAddress]::Parse($a).GetAddressBytes(); $y = [Net.IPAddress]::Parse($b).GetAddressBytes()
    for ($i = 0; $i -lt 4; $i++) {
        $bits = [Math]::Max(0, [Math]::Min(8, $prefix - $i * 8))
        $mask = (0xFF -shl (8 - $bits)) -band 0xFF
        if (($x[$i] -band $mask) -ne ($y[$i] -band $mask)) { return $false }
    }
    $true
}

# ---------- 0. what to test ----------
Say ''
Say '=== KIỂM TRA MẠNG CHO MÀN HÌNH LỊCH HỌP ===' White
if (-not $Tang) { $Tang = Ask 'Tên tầng / vị trí đang kiểm tra' $env:COMPUTERNAME }
if (-not $Server) { $Server = Ask 'IP máy chủ lịch họp' $DefaultServer }
if ($ScreenPort -le 0) { $ScreenPort = [int](Ask 'Cổng màn hình' $DefaultScreen) }
if ($AdminPort -le 0) { $AdminPort = [int](Ask 'Cổng quản trị' $DefaultAdmin) }
$stamp = Get-Date
Note "Kiểm tra mạng – $Tang – $($stamp.ToString('dd/MM/yyyy HH:mm:ss')) – máy $env:COMPUTERNAME"
Note "Máy chủ $Server, cổng màn hình $ScreenPort, cổng quản trị $AdminPort"
Note ''

# ---------- 1. this laptop's address on the floor ----------
Say ''
Say '1. Địa chỉ mạng của máy này' White
$cfgs = @(Get-NetIPConfiguration | Where-Object { $_.IPv4Address -and $_.NetAdapter.Status -eq 'Up' -and $_.InterfaceAlias -notmatch 'vEthernet|Loopback|VirtualBox|VMware|WSL|Hyper-V' })
$cfg = $cfgs | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1
if (-not $cfg) { $cfg = $cfgs | Select-Object -First 1 }
$ip = $null; $prefix = 24; $gw = $null
if ($cfg) {
    $ip = $cfg.IPv4Address[0].IPAddress
    $prefix = [int]$cfg.IPv4Address[0].PrefixLength
    $gw = if ($cfg.IPv4DefaultGateway) { $cfg.IPv4DefaultGateway[0].NextHop } else { $null }
    $dhcp = (Get-NetIPInterface -InterfaceIndex $cfg.InterfaceIndex -AddressFamily IPv4).Dhcp
    $apipa = $ip -like '169.254.*'
    Result 'ip' (-not $apipa) 'Có IP' ("{0} ({1}) /{2} = mask {3}, {4}" -f $ip, $cfg.InterfaceAlias, $prefix, (Prefix-To-Mask $prefix), $(if ($dhcp -eq 'Enabled') { 'DHCP cấp' } else { 'đặt tay' })) `
        'IP 169.254.x.x = không nhận được DHCP: kiểm tra dây, cổng switch, VLAN của cổng và DHCP của tầng này (huong-dan-mang.md, mục 2)'
    Result 'gw' ([bool]$gw) 'Có gateway' $(if ($gw) { $gw } else { 'không có' }) 'Không có gateway thì không ra khỏi tầng được: kiểm tra DHCP (option router) hoặc đặt tay (huong-dan-mang.md, mục 2)'
    Info 'DNS' (($cfg.DNSServer | Where-Object { $_.AddressFamily -eq 2 }).ServerAddresses -join ', ')
    if ($cfgs.Count -gt 1) {
        Info 'Đang bật nhiều card mạng' ((($cfgs | ForEach-Object { "$($_.InterfaceAlias)=$($_.IPv4Address[0].IPAddress)" })) -join ', ')
        Say '        → Nên tắt Wi-Fi khi kiểm tra để chắc chắn đang đi qua switch của tầng' Yellow
    }
} else {
    Result 'ip' $false 'Có IP' 'không có card mạng nào đang kết nối' 'Cắm dây mạng vào switch của tầng rồi chạy lại'
}

# ---------- 2. gateway ----------
if ($gw) {
    $ping = Test-Connection -ComputerName $gw -Count 2 -Quiet -ErrorAction SilentlyContinue
    if ($ping) { Info 'Ping gateway' "$gw trả lời" } else { Info 'Ping gateway' "$gw không trả lời ping (thiết bị có thể chặn ping, chưa chắc là lỗi)" }
}

# ---------- 3. screen port: what every standee needs ----------
Say ''
Say "2. Cổng màn hình $Server`:$ScreenPort (bắt buộc cho standee)" White
$t = Test-Tcp $Server $ScreenPort
$fix = if ($t.Refused) { "Mạng đã thông; trên máy chủ kiểm tra dịch vụ (Get-Service LedConference) và cổng màn hình trong data\settings.json (huong-dan-mang.md, mục 3)" }
       else { "Mở đường từ dải mạng của tầng này ($ip/$prefix) tới $Server TCP $ScreenPort trên thiết bị định tuyến giữa các tầng (huong-dan-mang.md, mục 4)" }
Result 'tcpScreen' $t.Ok "Kết nối TCP $ScreenPort" $(if ($t.Ok) { "thông ($($t.Ms) ms)" } else { $t.Why }) $fix
if ($t.Ok) {
    $r = Get-Http "http://$Server`:$ScreenPort/api/screens"
    $ok = $r.Code -eq 200 -and $r.Body -match '"app"\s*:\s*"LedConference"'
    $rooms = ([regex]::Matches($r.Body, '"code"\s*:')).Count
    Result 'api' $ok 'Máy chủ lịch họp trả lời' $(if ($ok) { "$rooms phòng, $($r.Ms) ms" } elseif ($r.Code) { "HTTP $($r.Code), không phải máy chủ lịch họp" } else { $r.Why }) `
        "Cổng $ScreenPort mở nhưng không phải LedConference: kiểm tra lại IP/cổng (trang quản trị > Phòng & màn hình > Địa chỉ cho app)"
    $l = Get-Http "http://$Server`:$ScreenPort/lobby"
    Result 'lobby' ($l.Code -eq 200) 'Trang màn hình sảnh /lobby' $(if ($l.Code) { "HTTP $($l.Code)" } else { $l.Why }) 'Máy chủ bản cũ chưa có màn hình sảnh: cài lại bản mới'
}

# ---------- 4. route ----------
Say ''
Say '3. App có tự tìm thấy máy chủ không?' White
if ($ip) {
    $same24 = Same-Net $ip $Server 24
    if ($same24) { Info 'Tự tìm' "CÓ: máy chủ nằm trong dải $(($ip -split '\.')[0..2] -join '.').x của tầng này, app Android tự quét thấy" }
    else { Info 'Tự tìm' "KHÔNG: máy chủ khác dải mạng, trên standee nhập tay $Server`:$ScreenPort ở ô 'Nhập địa chỉ máy chủ' (huong-dan-mang.md, mục 6)" }
    $results['autoFind'] = $same24
}

Say ''
Say '4. Đường đi tới máy chủ (tối đa ~20 giây)' White
$hops = @()
$trace = & tracert.exe -d -h 10 -w 600 $Server 2>$null
foreach ($line in $trace) {
    if ($line -match '^\s*(\d+)\s+.*?(\d{1,3}(\.\d{1,3}){3})\s*$') { $hops += $Matches[2] }
    elseif ($line -match '^\s*(\d+)\s+(\*\s+){3}') { $hops += '*' }
}
if ($hops.Count) {
    Info 'Các bước' ($hops -join ' → ')
    $first = $hops | Where-Object { $_ -ne '*' -and $_ -ne $Server } | Select-Object -First 1
    if ($first) { Info 'Thiết bị định tuyến đầu tiên' "$first (nơi cần mở đường / ACL nếu cổng $ScreenPort bị chặn)" }
    elseif ($hops[0] -eq $Server) { Info 'Thiết bị định tuyến' 'không có: máy chủ cùng mạng với máy này' }
    elseif ($gw) { Info 'Thiết bị định tuyến' "không trả lời tracert (thường bị chặn); bắt đầu kiểm tra từ gateway của tầng: $gw" }
} else { Info 'Các bước' 'không đo được (tracert bị chặn)' }
$results['hops'] = ($hops -join ' ')

# ---------- 5. admin port ----------
Say ''
Say "5. Cổng quản trị $Server`:$AdminPort (chỉ cần cho máy văn phòng)" White
$a = Test-Tcp $Server $AdminPort
$fix = if ($a.Refused) { "Mạng đã thông; kiểm tra cổng quản trị trong data\settings.json trên máy chủ (huong-dan-mang.md, mục 3)" }
       else { "Nếu tầng này có máy cần vào trang quản trị: mở đường tới $Server TCP $AdminPort. Standee không cần cổng này. (huong-dan-mang.md, mục 4)" }
Result 'tcpAdmin' $a.Ok "Kết nối TCP $AdminPort" $(if ($a.Ok) { "thông ($($a.Ms) ms)" } else { $a.Why }) $fix
if ($a.Ok) {
    $s = Get-Http "http://$Server`:$AdminPort/api/settings"
    if ($s.Code -eq 200) { Result 'admin' $true 'Được phép vào trang quản trị' "http://$Server`:$AdminPort/" '' }
    elseif ($s.Code -eq 403) { Result 'admin' $false 'Được phép vào trang quản trị' "bị chặn: IP $ip không nằm trong adminAllow" "Thêm dải mạng này vào adminAllow trong data\settings.json trên máy chủ rồi chạy Restart-Service LedConference (huong-dan-mang.md, mục 5)" }
    else { Result 'admin' $false 'Trang quản trị' $(if ($s.Code) { "HTTP $($s.Code)" } else { $s.Why }) 'Kiểm tra lại cổng quản trị' }
}

# ---------- 6. internet (information only) ----------
Say ''
Say '6. Internet (chỉ để tham khảo, hệ thống KHÔNG cần Internet)' White
$net = Test-Tcp 'www.google.com' 443 3000
Info 'Internet' $(if ($net.Ok) { 'có' } else { 'không có (bình thường với mạng nội bộ)' })
$results['internet'] = $net.Ok

# ---------- summary + report ----------
$ready = $results['tcpScreen'] -and $results['api']
Say ''
if ($ready) { Say "=== KẾT LUẬN: standee ở '$Tang' CHẠY ĐƯỢC (địa chỉ cho app: $Server`:$ScreenPort) ===" Green }
else {
    Say "=== KẾT LUẬN: standee ở '$Tang' CHƯA CHẠY ĐƯỢC – xem các dòng LỖI ở trên ===" Red
    Say "Hướng dẫn cấu hình từng lỗi: $(Join-Path $PSScriptRoot 'huong-dan-mang.md')" Yellow
}
Note ''
Note $(if ($ready) { "KẾT LUẬN: CHẠY ĐƯỢC" } else { "KẾT LUẬN: CHƯA CHẠY ĐƯỢC" })

$outDir = Join-Path $PSScriptRoot 'ket-qua'
New-Item -ItemType Directory -Force $outDir | Out-Null
$safe = ($Tang -replace '[\\/:*?"<>|\s]+', '_')
$file = Join-Path $outDir ("{0}_{1}.txt" -f $safe, $stamp.ToString('yyyyMMdd-HHmmss'))
$lines | Set-Content -Path $file -Encoding UTF8
$csv = Join-Path $outDir 'tong-hop.csv'
$v = { param($k) if ($results.Contains($k)) { if ($results[$k] -is [bool]) { if ($results[$k]) { 'OK' } else { 'LỖI' } } else { $results[$k] } } else { '' } }
[pscustomobject][ordered]@{
    'Thời gian' = $stamp.ToString('yyyy-MM-dd HH:mm'); 'Tầng' = $Tang; 'Máy' = $env:COMPUTERNAME; 'IP' = $ip; 'Prefix' = $prefix; 'Gateway' = $gw
    'Cổng màn hình' = & $v 'tcpScreen'; 'Máy chủ' = & $v 'api'; 'Sảnh' = & $v 'lobby'; 'Cổng quản trị' = & $v 'tcpAdmin'; 'Quản trị' = & $v 'admin'
    'Tự tìm máy chủ' = & $v 'autoFind'; 'Internet' = & $v 'internet'; 'Đường đi' = $results['hops']; 'Kết luận' = $(if ($ready) { 'CHẠY ĐƯỢC' } else { 'CHƯA' })
} | Export-Csv -Path $csv -Append -NoTypeInformation -Encoding UTF8
Say ''
Say "Báo cáo: $file"
Say "Bảng tổng hợp các tầng: $csv (mở bằng Excel)"
