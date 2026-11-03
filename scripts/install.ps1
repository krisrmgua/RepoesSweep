# Install Repoes Sweep on Windows (run from a normal PowerShell)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm is required. Install Node.js 20 LTS or newer first."
}
$NodeMajor = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($NodeMajor -lt 20) {
  throw "Node.js 20 or newer is required (found $(node -v))."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Warning "git is not on PATH. Install Git for Windows; the app needs it to scan clones."
}

npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
npm run pack:win
if ($LASTEXITCODE -ne 0) { throw "npm run pack:win failed" }

$Setup = Get-ChildItem -Path (Join-Path $Root "release") -Filter "Repoes Sweep Setup*.exe" |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $Setup) {
  throw "Installer not found under release\"
}

Get-Process -Name "Repoes Sweep" -ErrorAction SilentlyContinue | Stop-Process -Force

Write-Host "Launching $($Setup.FullName)"
Start-Process -FilePath $Setup.FullName -Wait
Write-Host "Repoes Sweep installer finished. The tray icon appears after launch (check the ^ overflow)."
