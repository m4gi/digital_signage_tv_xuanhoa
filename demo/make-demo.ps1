# Builds demo\site\: the real pages from src\LedConference\web plus mock.js, runnable as static files.
# Rewrites the server's absolute paths (/assets/, /logo) to relative ones and loads mock.js first.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$web = Join-Path $root 'src\LedConference\web'
$out = Join-Path $PSScriptRoot 'site'
if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory $out | Out-Null

$utf8 = New-Object Text.UTF8Encoding $false
foreach ($f in Get-ChildItem $web) {
  $dst = Join-Path $out $f.Name
  if ($f.Extension -in '.html', '.css', '.js') {
    $t = [IO.File]::ReadAllText($f.FullName)
    $t = $t.Replace('/assets/', '').Replace('"/logo?v=', '"logo.webp?v=').Replace('`/logo?v=', '`logo.webp?v=').Replace('url("/logo?v=', 'url("logo.webp?v=')
    if ($f.Name -in 'display.html', 'admin.html') {
      $page = $f.BaseName
      $t = $t.Replace("<script src=""$page.js""></script>", "<script src=""mock.js""></script>`n<script src=""$page.js""></script>")
    }
    [IO.File]::WriteAllText($dst, $t, $utf8)
  } else {
    Copy-Item $f.FullName $dst
  }
}
Copy-Item (Join-Path $PSScriptRoot 'mock.js') $out
Copy-Item (Join-Path $PSScriptRoot 'index.html') $out
Write-Host "demo\site ready:" (Get-ChildItem $out | ForEach-Object Name)
