# ============================================================================
# Atom Support Vision — restart everything (local dev, no Docker required).
# Usage:  powershell -ExecutionPolicy Bypass -File restart.ps1
# Opens 3 windows: Media (mediasoup SFU), API (FastAPI), Web (Next.js).
#
# Requires Postgres + Redis + MinIO reachable on their default ports. If you use
# Docker for those, start Docker Desktop first, or run:
#   docker compose up -d postgres redis minio
# (this script does NOT manage infra so a missing Docker can't block the apps).
# ============================================================================
$root = $PSScriptRoot

Write-Host "==> Killing stale processes on :3000 / :4000 / :5000" -ForegroundColor Cyan
foreach ($port in 3000,4000,5000) {
  try {
    $procId = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue).OwningProcess
    if ($procId) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue; Write-Host "   killed pid $procId on :$port" }
  } catch {}
}

Write-Host "==> Building shared package" -ForegroundColor Cyan
npm --prefix "$root\packages\shared" run build
if ($LASTEXITCODE -ne 0) { Write-Host "shared build failed" -ForegroundColor Red; exit 1 }

Write-Host "==> Building media server" -ForegroundColor Cyan
npm --prefix "$root\apps\media" run build
if ($LASTEXITCODE -ne 0) { Write-Host "media build failed" -ForegroundColor Red; exit 1 }

# Quick infra reachability check (informational only — never blocks startup).
function Test-Port($p) { try { (New-Object Net.Sockets.TcpClient).Connect('localhost',$p); $true } catch { $false } }
foreach ($svc in @{n='Postgres';p=5432}, @{n='Redis';p=6379}, @{n='MinIO';p=9000}) {
  if (Test-Port $svc.p) { Write-Host "   $($svc.n) reachable on :$($svc.p)" -ForegroundColor DarkGreen }
  else { Write-Host "   WARNING: $($svc.n) NOT reachable on :$($svc.p) — start it (e.g. docker compose up -d postgres redis minio)" -ForegroundColor Yellow }
}

Write-Host "==> Starting MEDIA server (new window)" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\apps\media'; `$env:MEDIA_NUM_WORKERS='1'; node dist/index.js"

Start-Sleep -Seconds 2
Write-Host "==> Starting API server (new window)" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\apps\backend'; if (Test-Path .venv\Scripts\Activate.ps1) { .\.venv\Scripts\Activate.ps1 }; alembic upgrade head; uvicorn app.main:app --reload --host 0.0.0.0 --port 4000"

Start-Sleep -Seconds 2
Write-Host "==> Starting WEB server (new window)" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root'; npm run dev:web"

Write-Host ""
Write-Host "Started 3 windows. Give them ~15s, then open http://localhost:3000" -ForegroundColor Yellow
Write-Host "  Check:  curl http://localhost:5000/health   and   curl http://localhost:4000/health"
