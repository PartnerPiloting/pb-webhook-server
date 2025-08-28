param(
    [int]$ApiPort = 3001,
    [int]$WebPort = 3000,
    [int]$AltWebPort = 3007,
    [switch]$Force
)

Write-Host "[auto] Starting automated dev bootstrap..." -ForegroundColor Cyan

# 1. Kill stray node processes if Force specified
if ($Force) {
    Write-Host "[auto] Force mode: killing all node.exe" -ForegroundColor Yellow
    Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
}

# 2. Ensure ports free
function Test-PortFree($port){
    netstat -ano | findstr LISTENING | findstr :$port > $null 2>&1; if ($LASTEXITCODE -eq 0){ return $false } else { return $true }
}

if (-not (Test-PortFree $ApiPort)) { Write-Host "[auto] Port $ApiPort busy -> killing owning process" -ForegroundColor Yellow; 
    $line = netstat -ano | findstr LISTENING | findstr :$ApiPort | Select-Object -First 1; $ownerPid = ($line -split "\s+")[-1]; if ($ownerPid){ taskkill /PID $ownerPid /F > $null 2>&1 }
}
if (-not (Test-PortFree $WebPort)) { Write-Host "[auto] Port $WebPort busy -> using alt $AltWebPort" -ForegroundColor Yellow; $WebPort = $AltWebPort }

# 3. Install deps if node_modules missing
if (-not (Test-Path node_modules)) {
    Write-Host "[auto] Installing root deps..." -ForegroundColor Green
    npm install --no-audit --no-fund | Out-Null
}
if (-not (Test-Path linkedin-messaging-followup-next/node_modules)) {
    Write-Host "[auto] Installing frontend deps..." -ForegroundColor Green
    npm --prefix linkedin-messaging-followup-next install --no-audit --no-fund | Out-Null
}

# 4. Start API (detached)
Write-Host "[auto] Launching API on $ApiPort..." -ForegroundColor Green
Start-Process -WindowStyle Minimized powershell -ArgumentList "-NoProfile","-Command","npm run dev:api" | Out-Null

# 5. Poll API health
$max=40; $ok=$false
for($i=1;$i -le $max;$i++){
  try { $resp = (Invoke-WebRequest -UseBasicParsing http://localhost:$ApiPort/basic-test -TimeoutSec 2).Content; if($resp -match 'BASIC ROUTE WORKING'){ $ok=$true; break } } catch {}
  Start-Sleep -Milliseconds 500
}
if(-not $ok){ Write-Host "[auto] API health failed after timeout" -ForegroundColor Red; exit 1 }
Write-Host "[auto] API healthy." -ForegroundColor Green

# 6. Start Frontend
$env:NEXT_PUBLIC_API_BASE_URL = "http://localhost:$ApiPort"
Write-Host "[auto] Launching Frontend on $WebPort..." -ForegroundColor Green
Start-Process -WindowStyle Minimized powershell -ArgumentList "-NoProfile","-Command","npm --prefix linkedin-messaging-followup-next run dev -- -p $WebPort" | Out-Null

Write-Host "[auto] Waiting for Frontend to listen (http://localhost:$WebPort)..." -ForegroundColor Cyan
Start-Sleep -Seconds 6

Write-Host "[auto] READY: API http://localhost:$ApiPort  |  UI http://localhost:$WebPort/?testClient=Guy-Wilson" -ForegroundColor Cyan
Write-Host "[auto] (Minimized windows can be restored from taskbar if needed; close them to stop servers.)" -ForegroundColor DarkGray
