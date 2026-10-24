# Installs LedConference as a Windows service. Started by install.bat (as Administrator).
#   1. stops an existing install, so its own ports count as free
#   2. scans ports, suggests a free pair, lets the user type their own (re-asks on bad/busy input)
#   3. writes the ports into data\settings.json (other settings untouched), asks the admin IPs on first install
#   4. registers the service, Event Log source, folder rights, firewall rules, starts it and checks both ports answer
# install.ps1 -ScanOnly only prints the port scan and the suggestion (no admin rights needed, changes nothing).
# Messages are plain ASCII so every cmd window shows them correctly.
param([switch]$ScanOnly)

$ErrorActionPreference = 'Stop'
$svc = 'LedConference'
$dir = $PSScriptRoot
$exe = Join-Path $dir 'LedConference.exe'
$data = Join-Path $dir 'data'
$settingsPath = Join-Path $data 'settings.json'

function Say([string]$text, [string]$color = 'Gray') { Write-Host $text -ForegroundColor $color }

# ---------- ports ----------

# Ranges Windows reserves (Hyper-V, Docker, WSL): a port there looks free but cannot be opened.
$excluded = @()
foreach ($family in 'ipv4', 'ipv6') {
    netsh int $family show excludedportrange protocol=tcp | ForEach-Object {
        if ($_ -match '^\s*(\d+)\s+(\d+)') { $excluded += , @([int]$Matches[1], [int]$Matches[2]) }
    }
}

# Returns why a port cannot be used, or $null when it is free. Any listener counts, on any address
# (a service on 127.0.0.1:8080 still clashes with ours, which listens on every address).
function Get-PortProblem([int]$port) {
    $conn = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($conn) {
        $name = (Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue).ProcessName
        return "dang duoc dung boi $name (PID $($conn.OwningProcess))"
    }
    foreach ($r in $excluded) {
        if ($port -ge $r[0] -and $port -le $r[1]) { return "nam trong dai Windows giu cho ($($r[0])-$($r[1]))" }
    }
    return $null
}

function Read-SettingsPort([string]$key, [int]$fallback) {
    if (Test-Path $settingsPath) {
        $m = [regex]::Match([IO.File]::ReadAllText($settingsPath), '"' + $key + '"\s*:\s*(\d+)')
        if ($m.Success) { return [int]$m.Groups[1].Value }
    }
    return $fallback
}

# Changes only the two port numbers in settings.json text, so every other setting stays exactly as it was.
function Set-Ports([string]$text, [int]$screen, [int]$admin) {
    foreach ($kv in @(@('screenPort', $screen), @('adminPort', $admin))) {
        $pattern = '("' + $kv[0] + '"\s*:\s*)\d+'
        if ($text -match $pattern) { $text = $text -replace $pattern, ('${1}' + $kv[1]) }
        else { $text = $text -replace '^\s*\{', ("{`n  `"" + $kv[0] + "`": " + $kv[1] + ',') }
    }
    return $text
}

function Find-FreePair {
    foreach ($p in (8080..8199) + (18080..18199)) {
        if (-not (Get-PortProblem $p) -and -not (Get-PortProblem ($p + 1))) { return @($p, ($p + 1)) }
    }
    return $null
}

function Show-Scan([int[]]$ports) {
    Say ''
    Say 'Kiem tra cong:' White
    foreach ($p in ($ports | Sort-Object -Unique)) {
        $problem = Get-PortProblem $p
        if ($problem) { Say ("  {0,-6} BAN   {1}" -f $p, $problem) Yellow } else { Say ("  {0,-6} TRONG" -f $p) Green }
    }
}

function Read-Port([string]$label, [int]$suggest, [int]$other) {
    while ($true) {
        $answer = Read-Host "$label [Enter = $suggest]"
        if (-not $answer) { $answer = "$suggest" }
        $port = 0
        if (-not [int]::TryParse($answer.Trim(), [ref]$port) -or $port -lt 1024 -or $port -gt 65535) {
            Say '  Cong phai la so tu 1024 den 65535.' Yellow; continue
        }
        if ($port -eq $other) { Say '  Cong man hinh va cong quan tri phai khac nhau.' Yellow; continue }
        $problem = Get-PortProblem $port
        if ($problem) { Say "  Cong $port $problem. Hay chon cong khac." Yellow; continue }
        return $port
    }
}

# ---------- 1. stop an existing install ----------

if (-not $ScanOnly -and -not (Test-Path $exe)) { Say "Khong thay LedConference.exe trong $dir" Red; exit 1 }
$existing = Get-Service $svc -ErrorAction SilentlyContinue
if ($existing -and -not $ScanOnly) {
    Say 'Dich vu da duoc cai truoc do: dung ban cu de cai lai (du lieu trong data\ duoc giu nguyen)...'
    Stop-Service $svc -Force -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 20 -and (Get-Process $svc -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
}

# ---------- 2. scan and choose ports ----------

$current = @((Read-SettingsPort 'screenPort' 8080), (Read-SettingsPort 'adminPort' 8081))
$suggest = if (-not (Get-PortProblem $current[0]) -and -not (Get-PortProblem $current[1])) { $current } else { Find-FreePair }
Show-Scan (@(8080, 8081) + $current + $(if ($suggest) { $suggest } else { @() }))
if (-not $suggest) { Say 'Khong tim thay cap cong trong trong 8080-8199 va 18080-18199. Hay tu nhap cong.' Yellow; $suggest = @(18080, 18081) }
Say ''
Say ("De xuat: cong man hinh {0}, cong quan tri {1}" -f $suggest[0], $suggest[1]) Cyan
if ($ScanOnly) { exit 0 }

Say ''
$screenPort = Read-Port 'Cong man hinh (link cho Fully Kiosk / APK)' $suggest[0] 0
$adminSuggest = if ($suggest[1] -ne $screenPort -and -not (Get-PortProblem $suggest[1])) { $suggest[1] } else {
    ($screenPort + 1)..65535 | Where-Object { -not (Get-PortProblem $_) } | Select-Object -First 1
}
$adminPort = Read-Port 'Cong trang quan tri' $adminSuggest $screenPort

# ---------- 3. settings.json ----------

New-Item -ItemType Directory -Force $data | Out-Null
$utf8 = New-Object Text.UTF8Encoding $false
if (Test-Path $settingsPath) {
    [IO.File]::WriteAllText($settingsPath, (Set-Ports ([IO.File]::ReadAllText($settingsPath)) $screenPort $adminPort), $utf8)
} else {
    Say ''
    Say 'Nhap IP hoac dai IP cac may duoc vao trang quan tri, cach nhau dau phay.'
    Say 'Vi du: 192.168.1.20, 192.168.1.21, 192.168.1.0/24'
    Say 'Bo trong va bam Enter = MOI MAY trong mang deu vao duoc (thu hep sau trong data\settings.json).'
    $answer = Read-Host 'IP quan tri'
    $allow = @()
    foreach ($x in ($answer -split ',')) {
        $x = $x.Trim(); if (-not $x) { continue }
        $ip = $null
        if ([Net.IPAddress]::TryParse(($x -split '/')[0], [ref]$ip)) { $allow += $x } else { Say "  Bo qua gia tri sai: $x" Yellow }
    }
    $blank = -not ($answer -replace '[\s,]', '')
    if ($blank) { $allow = @('0.0.0.0/0', '::/0') }
    $json = ConvertTo-Json @{ screenPort = $screenPort; adminPort = $adminPort; adminAllow = $allow } -Depth 3
    [IO.File]::WriteAllText($settingsPath, $json, $utf8)
    Say ('  Da luu: ' + $(if ($blank) { 'moi may trong mang' } elseif ($allow.Count) { $allow -join ', ' } else { 'chi may chu (khong co IP hop le)' }))
}

# ---------- 4. service, firewall, start, check ----------

Say ''
Say "== Cai dich vu Windows `"$svc`"" White
if ($existing) {
    sc.exe delete $svc | Out-Null
    for ($i = 0; $i -lt 20 -and (Get-Service $svc -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Milliseconds 500 }
}
New-Service -Name $svc -BinaryPathName ('"' + $exe + '"') -DisplayName 'Lich hop phong hop (LedConference)' -StartupType Automatic `
    -Description "May chu lich hop cho man hinh truoc phong hop. Man hinh: cong $screenPort, quan tri: cong $adminPort." | Out-Null
# Restart after a crash: 5s, 5s, then 30s; the failure count resets daily.
sc.exe failure $svc reset= 86400 actions= restart/5000/restart/5000/restart/30000 | Out-Null
# The service account cannot register an Event Log source itself, so errors would be lost; register it here.
if (-not [Diagnostics.EventLog]::SourceExists($svc)) { New-EventLog -LogName Application -Source $svc }
# Own low-privilege virtual account, not SYSTEM: read the program folder, write only data\.
sc.exe config $svc obj= "NT SERVICE\$svc" | Out-Null
icacls $dir /grant "NT SERVICE\${svc}:(OI)(CI)RX" | Out-Null
icacls $data /grant "NT SERVICE\${svc}:(OI)(CI)M" | Out-Null

Say "== Mo tuong lua: cong $screenPort (man hinh), $adminPort (quan tri)" White
foreach ($name in 'LedConference - man hinh', 'LedConference - quan tri') {
    Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
}
New-NetFirewallRule -DisplayName 'LedConference - man hinh' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $screenPort | Out-Null
New-NetFirewallRule -DisplayName 'LedConference - quan tri' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $adminPort | Out-Null

Say '== Khoi dong va kiem tra' White
Start-Service $svc
function Test-Answers([string]$url) {
    try { return (Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}
$adminOk = $false; $screenOk = $false
for ($i = 0; $i -lt 30 -and -not ($adminOk -and $screenOk); $i++) {
    Start-Sleep -Milliseconds 500
    $adminOk = Test-Answers "http://127.0.0.1:$adminPort/"
    $screenOk = Test-Answers "http://127.0.0.1:$screenPort/assets/display.css"
}
$owners = foreach ($p in $screenPort, $adminPort) {
    $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName } else { '(khong co)' }
}
Say ("  Cong {0} (man hinh): {1}, do {2} tra loi" -f $screenPort, $(if ($screenOk) { 'OK' } else { 'KHONG tra loi' }), $owners[0]) $(if ($screenOk) { 'Green' } else { 'Red' })
Say ("  Cong {0} (quan tri): {1}, do {2} tra loi" -f $adminPort, $(if ($adminOk) { 'OK' } else { 'KHONG tra loi' }), $owners[1]) $(if ($adminOk) { 'Green' } else { 'Red' })
if (-not ($adminOk -and $screenOk)) {
    Say ''
    Say 'Dich vu CHUA chay dung. Xem loi trong Event Viewer > Windows Logs > Application, nguon "LedConference" hoac ".NET Runtime".' Red
    Say 'Cach nhanh nhat de xem loi: dung dich vu roi bam dup LedConference.exe.' Red
    exit 1
}

Say ''
Say 'Da cai xong. Dich vu tu chay lai khi khoi dong may.' Green
Say 'Trang quan tri (mo tu may duoc phep):'
Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { Say "   http://$($_.IPAddress):$adminPort/" Cyan }
Say "Link man hinh tung phong: trang quan tri > Phong hop & man hinh (dang http://<IP>:$screenPort/room/<ma phong>)."
