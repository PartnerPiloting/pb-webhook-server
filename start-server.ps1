# PowerShell script to start the server
Set-Location "c:\Users\guyra\Desktop\pb-webhook-server"
Write-Host "Starting LinkedIn Follow-Up Portal Server..." -ForegroundColor Green
Write-Host "Server will be available at: http://localhost:3000/linkedin/?client=Guy-Wilson" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""
node index.js
