# CardTracker launcher for Windows. The Linux equivalent is start.sh; the two
# are kept deliberately parallel so a change to one is easy to mirror.
#
# Run from PowerShell:  .\start.ps1
# If Windows blocks it: powershell -ExecutionPolicy Bypass -File .\start.ps1

$ErrorActionPreference = 'Stop'

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$MClubDir   = Join-Path (Split-Path -Parent $ProjectDir) 'MClubCards'

# A virtualenv is not portable between operating systems — .venv on the Ubuntu
# box has bin/ and Linux binaries, which Windows cannot run. Windows gets its own
# directory so the two can coexist in the same folder (e.g. a synced drive)
# without either clobbering the other.
$VenvDir = Join-Path $ProjectDir '.venv-windows'
$VenvPy  = Join-Path $VenvDir 'Scripts\python.exe'

# Python versions this project's pinned dependencies ship wheels for, best
# first. 3.14 is deliberately excluded: pydantic-core has no 3.14 wheel yet, so
# pip falls back to compiling Rust and fails without Visual Studio build tools.
$SupportedPython = @('3.13', '3.12', '3.11')

function Stop-PortListener {
    param([int]$Port)
    # The Linux script uses `fuser -k`; this is the same idea.
    try {
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique |
            ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    } catch {
        # Nothing listening on that port — the normal case.
    }
}

function Get-LanAddress {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
        Sort-Object -Property SkipAsSource, InterfaceMetric |
        Select-Object -First 1 -ExpandProperty IPAddress
    if ($ip) { return $ip }
    return 'localhost'
}

$Jobs = @()

# ── Pipeline dashboard (MClubCards) ──────────────────────────────────────────
if ((Test-Path $MClubDir) -and (Get-Command uv -ErrorAction SilentlyContinue)) {
    Write-Host 'Starting pipeline dashboard (mclub gui) on port 8765...'
    $Jobs += Start-Process -FilePath 'uv' `
        -ArgumentList 'run', 'mclub', 'gui', '--no-browser', '--port', '8765' `
        -WorkingDirectory $MClubDir -PassThru -NoNewWindow
} else {
    Write-Host 'Skipping pipeline dashboard - MClubCards not found next to this repo, or uv is not installed.'
}

# ── Backend ──────────────────────────────────────────────────────────────────
Write-Host 'Starting backend (FastAPI) on port 8000...'

if (-not (Test-Path $VenvPy)) {
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if (-not $launcher) {
        throw "Python is not installed, or the 'py' launcher is missing. Install Python $($SupportedPython[0]) from python.org and re-run."
    }

    $installed = (& py -0p) -join "`n"
    $chosen = $SupportedPython | Where-Object { $installed -match [regex]::Escape("-V:$_") } | Select-Object -First 1
    if (-not $chosen) {
        throw ("No supported Python found. This project needs one of: $($SupportedPython -join ', ').`n" +
               "Installed:`n$installed`n" +
               "Python 3.14 will not work - pydantic has no 3.14 wheel and pip would try to compile Rust.")
    }

    Write-Host "Creating Python virtual environment (Python $chosen)..."
    & py "-$chosen" -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw "Failed to create the virtual environment at $VenvDir." }
}

Write-Host 'Installing backend dependencies...'
& $VenvPy -m pip install -q --disable-pip-version-check -r (Join-Path $ProjectDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Backend dependency install failed - see the pip output above.' }

New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir 'data')   | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ProjectDir 'photos') | Out-Null

Stop-PortListener -Port 8000

$Backend = Start-Process -FilePath $VenvPy `
    -ArgumentList '-m', 'uvicorn', 'backend.main:app', '--host', '0.0.0.0', '--port', '8000' `
    -WorkingDirectory $ProjectDir -PassThru -NoNewWindow
$Jobs += $Backend
Write-Host "Backend PID: $($Backend.Id)"

# ── Frontend ─────────────────────────────────────────────────────────────────
Write-Host 'Starting frontend (Vite) on port 3000...'
$FrontendDir = Join-Path $ProjectDir 'frontend'

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npm) {
    Stop-Process -Id $Backend.Id -Force -ErrorAction SilentlyContinue
    throw 'Node.js / npm is not installed. Install Node 18 or newer from nodejs.org, then re-run.'
}

if (-not (Test-Path (Join-Path $FrontendDir 'node_modules'))) {
    Write-Host 'Installing frontend dependencies...'
    & $npm.Source install --prefix $FrontendDir
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency install failed.' }
}

Stop-PortListener -Port 3000

$Frontend = Start-Process -FilePath $npm.Source -ArgumentList 'run', 'dev' `
    -WorkingDirectory $FrontendDir -PassThru -NoNewWindow
$Jobs += $Frontend
Write-Host "Frontend PID: $($Frontend.Id)"

# ── Done ─────────────────────────────────────────────────────────────────────
$lan = Get-LanAddress
Write-Host ''
Write-Host ([string][char]0x2501 * 38)
Write-Host ' CardTracker is running!'
Write-Host ' Open on this machine  : http://localhost:3000'
Write-Host " Open from iPad / phone: http://${lan}:3000"
Write-Host ([string][char]0x2501 * 38)
Write-Host 'Press Ctrl+C to stop both servers.'
Write-Host ''

try {
    # Wait for either server to exit, then take the whole stack down with it.
    while ($true) {
        if ($Backend.HasExited -or $Frontend.HasExited) { break }
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host 'Shutting down...'
    foreach ($p in $Jobs) {
        if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
    }
}
