# setup-tailscale.ps1
# One-time setup so you can reach Duet from your phone over the internet
# (cellular / any network) via Tailscale. Run this ONCE, at the PC, in an
# Administrator PowerShell. After this, it's permanent.
#
#   1. Right-click PowerShell -> "Run as administrator"
#   2. cd to this repo, then:  ./setup-tailscale.ps1
#
# It installs Tailscale (needs admin for the VPN driver), brings it up
# (you sign in once in the browser as nhyiramante@gmail.com), and prints the
# address to open on your phone.

$ErrorActionPreference = "Stop"

# --- must be elevated: the Tailscale driver install requires admin ---
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  Write-Host "This must run as Administrator (Tailscale installs a network driver)." -ForegroundColor Red
  Write-Host "Close this window, open PowerShell as administrator, and run it again." -ForegroundColor Red
  exit 1
}

# --- install Tailscale if it isn't already present ---
$tailscale = "C:\Program Files\Tailscale\tailscale.exe"
if (-not (Test-Path $tailscale)) {
  Write-Host "Installing Tailscale via winget..." -ForegroundColor Cyan
  winget install --exact --id Tailscale.Tailscale --accept-package-agreements --accept-source-agreements
} else {
  Write-Host "Tailscale already installed." -ForegroundColor Green
}

if (-not (Test-Path $tailscale)) {
  Write-Host "Tailscale did not install to the expected path. Check the winget output above." -ForegroundColor Red
  exit 1
}

# --- bring it up; opens a browser sign-in the first time ---
Write-Host "Bringing Tailscale up (sign in as nhyiramante@gmail.com if prompted)..." -ForegroundColor Cyan
& $tailscale up

# --- report the address to use from the phone ---
$ip = (& $tailscale ip -4 2>$null | Select-Object -First 1)
$port = 58208
Write-Host ""
Write-Host "Done. This PC is on your tailnet." -ForegroundColor Green
if ($ip) {
  Write-Host ("On your phone (Tailscale ON), open:  http://{0}:{1}" -f $ip, $port) -ForegroundColor Yellow
} else {
  Write-Host ("Run 'tailscale ip -4' to get this PC's address, then open http://<that-ip>:{0} on your phone." -f $port) -ForegroundColor Yellow
}
Write-Host "Then start Duet if it isn't running:  node dist/cli.js service start" -ForegroundColor Yellow
