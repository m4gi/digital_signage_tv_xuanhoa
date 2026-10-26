# API snapshot: starts a built LedConference.exe on ports 18080/18081 with empty data, drives every endpoint
# (screen port, admin port, port gate, validation errors, Excel round trip, themes, logo, audit) and writes
# what came back, with times and random ids replaced by stable tokens. Run it on two builds and compare the
# files to prove a refactor changed nothing:
#   powershell -File tests\api-snapshot.ps1 -ExeDir <folder with LedConference.exe> -Out before.txt
#   ... rebuild ...
#   powershell -File tests\api-snapshot.ps1 -ExeDir <new folder> -Out after.txt
#   fc before.txt after.txt
# Never use 8080/8081 here (other services on the dev machine). ASCII only.
param([Parameter(Mandatory = $true)][string]$ExeDir, [Parameter(Mandatory = $true)][string]$Out)
$ErrorActionPreference = 'Stop'
$S = 18080; $A = 18081
$exe = Join-Path $ExeDir 'LedConference.exe'
$data = Join-Path $ExeDir 'data'
if (Test-Path $data) { Remove-Item $data -Recurse -Force }
New-Item -ItemType Directory $data | Out-Null
[IO.File]::WriteAllText((Join-Path $data 'settings.json'), "{`"screenPort`":$S,`"adminPort`":$A,`"adminAllow`":[]}")
$proc = Start-Process $exe -WorkingDirectory $ExeDir -PassThru -WindowStyle Hidden
for ($i = 0; $i -lt 60; $i++) { Start-Sleep -Milliseconds 250; if (Get-NetTCPConnection -State Listen -LocalPort $A -ErrorAction SilentlyContinue) { break } }

$log = New-Object System.Collections.Generic.List[string]
$ids = @{}
function Norm([string]$s) {
    $s = [regex]::Replace($s, '"(serverTime|updatedAt|at|lastSeen|traceId)"\s*:\s*"[^"]*"', '"$1":"*"')
    [regex]::Replace($s, 'm_[0-9a-f]{10}|imp_\d{8}_\d{6}_[0-9a-f]{4}|mau-[0-9a-f]{6}', {
        param($m)
        if (-not $ids.ContainsKey($m.Value)) { $ids[$m.Value] = 'ID' + ($ids.Count + 1) }
        $ids[$m.Value]
    })
}
$script:last = $null
function Call([string]$method, [int]$port, [string]$path, $body = $null, [hashtable]$headers = @{}, [string]$type = 'application/json', [switch]$Binary) {
    $req = [Net.HttpWebRequest]::Create("http://127.0.0.1:$port$path")
    $req.Method = $method
    $req.Timeout = 15000
    foreach ($k in $headers.Keys) { $req.Headers[$k] = $headers[$k] }
    if ($null -ne $body) {
        $bytes = if ($body -is [byte[]]) { $body } else { [Text.Encoding]::UTF8.GetBytes($body) }
        $req.ContentType = $type
        $st = $req.GetRequestStream(); $st.Write($bytes, 0, $bytes.Length); $st.Close()
    }
    try { $res = $req.GetResponse() } catch [Net.WebException] { $res = $_.Exception.Response }
    $ms = New-Object IO.MemoryStream
    $res.GetResponseStream().CopyTo($ms)
    $raw = $ms.ToArray()
    $text = if ($Binary) { "<$($raw.Length -gt 0) bytes>" } else { [Text.Encoding]::UTF8.GetString($raw) }
    $h = @('Content-Type', 'Cache-Control', 'Content-Security-Policy', 'Access-Control-Allow-Origin', 'Access-Control-Allow-Methods', 'Content-Disposition') |
        Where-Object { $res.Headers[$_] } | ForEach-Object { "$_=$($res.Headers[$_])" }
    $log.Add("== $method $port " + (Norm $path))
    $log.Add("$([int]$res.StatusCode) | $($h -join ' | ')")
    $log.Add((Norm $text))
    $res.Close()
    $script:last = $text
    $text
}
function Id([string]$json, [string]$field = 'id') { ([regex]::Match($json, "`"$field`"\s*:\s*`"([^`"]+)`"")).Groups[1].Value }

$today = (Get-Date).ToString('yyyy-MM-dd')
try {
    # pages and assets
    Call GET $A '/' -Binary | Out-Null
    Call GET $A '/assets/admin.js' -Binary | Out-Null
    Call GET $A '/assets/nope.js' | Out-Null
    Call GET $S '/room/P1' -Binary | Out-Null
    Call GET $S '/lobby' -Binary | Out-Null
    Call GET $S '/assets/display.js' -Binary | Out-Null
    Call GET $S '/logo' -Binary | Out-Null

    # settings
    Call GET $A '/api/settings' | Out-Null
    Call PUT $A '/api/settings' '{"display":{"theme":"nope","effect":"x"},"morning":{"start":"11:00","end":"10:00"}}' | Out-Null
    Call PUT $A '/api/settings' '{"org":{"line1":" UBND ","line2":"PHUONG TEST"},"display":{"theme":"official","footerNote":"Tat chuong"}}' | Out-Null
    Call PUT $A '/api/settings' 'not json' | Out-Null

    # rooms
    Call POST $A '/api/rooms' '{"code":"p1","name":"Phong 1","places":["Phong hop 1","PH1"]}' | Out-Null
    Call POST $A '/api/rooms' '{"code":"P2","name":"Phong 2","places":[],"display":{"theme":"formal","orientation":"portrait"}}' | Out-Null
    Call POST $A '/api/rooms' '{"code":"a b","name":""}' | Out-Null
    Call POST $A '/api/rooms' '{"code":"P1","name":"Trung"}' | Out-Null
    Call PUT $A '/api/rooms/P2' '{"name":"Phong 2 moi","places":["Hoi truong B"],"display":{"theme":"formal"}}' | Out-Null
    Call PUT $A '/api/rooms/NOPE' '{"name":"x"}' | Out-Null

    # meetings
    Call POST $A '/api/meetings' "{`"date`":`"$today`",`"start`":`"00:00`",`"end`":`"23:58`",`"title`":`"Hop ca ngay`",`"chair`":`"Chu tich`",`"note`":`"Ghi chu an`",`"showNote`":false,`"contact`":`"Lan`",`"showContact`":true,`"roomCode`":`"P1`"}" | Out-Null
    $m1 = Id $script:last
    Call POST $A '/api/meetings' '{"date":"2030-01-08","start":"08:00","end":"09:00","title":"Hop tuong lai","roomCode":"P1"}' | Out-Null
    $m2 = Id $script:last
    Call POST $A '/api/meetings' "{`"date`":`"$today`",`"start`":`"10:00`",`"end`":`"11:00`",`"title`":`"Trung gio`",`"roomCode`":`"P1`"}" | Out-Null
    $m3 = Id $script:last
    Call POST $A '/api/meetings' "{`"date`":`"$today`",`"start`":`"11:00`",`"end`":`"10:00`",`"title`":`"`"}" | Out-Null
    Call POST $A '/api/meetings' "{`"date`":`"$today`",`"start`":`"14:00`",`"end`":`"15:00`",`"title`":`"O hoi truong`",`"place`":`"Hoi truong A`",`"status`":`"postponed`"}" | Out-Null
    Call PUT $A "/api/meetings/$m2" '{"date":"2030-01-08","start":"08:30","end":"09:30","title":"Hop tuong lai (sua)","roomCode":"P1"}' | Out-Null
    Call DELETE $A "/api/meetings/$m3" | Out-Null
    Call DELETE $A '/api/meetings/m_0000000000' | Out-Null
    Call GET $A "/api/meetings?from=$today&to=$today" | Out-Null
    Call GET $A '/api/meetings?from=2030-01-01&to=2030-01-31' | Out-Null
    Call GET $A '/api/meetings?from=2020-01-01&to=2030-01-01' | Out-Null

    # places
    Call GET $A '/api/places/unassigned' | Out-Null
    Call POST $A '/api/places/assign' '{"place":"Hoi truong A","roomCode":"P2"}' | Out-Null
    Call POST $A '/api/places/assign' '{"place":"PH1","roomCode":"P2"}' | Out-Null
    Call POST $A '/api/places/ignore' '{"place":"Ngoai troi"}' | Out-Null
    Call DELETE $A '/api/places/ignore?place=Ngoai%20troi' | Out-Null

    # themes
    Call GET $A '/api/themes' | Out-Null
    Call POST $A '/api/themes' '{"from":"official","name":"Ban sao"}' | Out-Null
    $t1 = Id $script:last
    Call PUT $A "/api/themes/$t1" '{"name":"Ban sao","bg1":"red"}' | Out-Null
    Call DELETE $A '/api/themes/official' | Out-Null
    Call POST $A '/api/themes/official/reset' | Out-Null
    Call POST $A "/api/themes/$t1/reset" | Out-Null
    Call DELETE $A "/api/themes/$t1" | Out-Null

    # Excel round trip: the template asks first (409) because this week has manual meetings
    $tpl = (New-Object Net.WebClient).DownloadData("http://127.0.0.1:$A/template.xlsx")
    Call GET $A '/template.xlsx' -Binary | Out-Null
    Call POST $A '/api/import' ([byte[]](1, 2, 3)) -type 'application/octet-stream' | Out-Null
    Call POST $A '/api/import' $tpl -type 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' -headers @{ 'X-File-Name' = 'mau.xlsx' } | Out-Null
    Call POST $A '/api/import?confirm=true' $tpl -type 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' -headers @{ 'X-File-Name' = 'mau.xlsx' } | Out-Null
    Call GET $A '/api/imports' | Out-Null
    $imp = Id $script:last
    Call GET $A "/api/imports/$imp/file" -Binary | Out-Null
    Call GET $A "/api/export?week=$today" -Binary | Out-Null

    # logo
    $webp = [IO.File]::ReadAllBytes((Join-Path $PSScriptRoot '..\src\LedConference\web\logo.webp'))
    Call POST $A '/api/logo' $webp -type 'image/webp' | Out-Null
    Call POST $A '/api/logo' ([byte[]](1, 2, 3)) -type 'image/png' | Out-Null
    Call GET $S '/logo?v=1' -Binary | Out-Null
    Call DELETE $A '/api/logo' | Out-Null

    # screen port: public data only, everything else is hidden
    Call GET $S '/api/screens' | Out-Null
    Call GET $S '/api/screens/P1?client=preview' | Out-Null
    Call GET $S '/api/screens/p2?client=preview' | Out-Null
    Call GET $S '/api/screens/NOPE?client=preview' | Out-Null
    Call GET $S '/api/lobby?client=preview' | Out-Null
    Call GET $S '/api/settings' | Out-Null
    Call POST $S '/api/rooms' '{"code":"X"}' | Out-Null
    Call OPTIONS $S '/api/screens/P1' | Out-Null
    Call GET $S '/api/lobbyinfo' | Out-Null

    # screen status: one screen per key
    Call GET $S '/api/screens/P1?client=apk' | Out-Null
    Call GET $S '/api/lobby?client=web' | Out-Null
    Call GET $A '/api/rooms' | Out-Null
    Call GET $A '/api/lobbyinfo' | Out-Null

    # admin port: same-origin writes only
    Call POST $A '/api/rooms' '{"code":"P9","name":"x"}' -headers @{ Origin = 'http://evil.example' } | Out-Null
    Call DELETE $A '/api/rooms/P2' | Out-Null
    Call GET $A '/api/audit?limit=200' | Out-Null
} finally {
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    [IO.File]::WriteAllLines($Out, $log, (New-Object Text.UTF8Encoding $false))
}
Write-Host "Snapshot: $($log.Count / 3) calls -> $Out"
