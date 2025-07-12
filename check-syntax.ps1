# Quick syntax check script for development
Write-Host "🔍 Running quick syntax check..." -ForegroundColor Yellow

# Check all JS files in routes directory
$routeFiles = Get-ChildItem -Path "routes" -Filter "*.js" -Recurse -ErrorAction SilentlyContinue
$routeFiles += Get-ChildItem -Path "LinkedIn-Messaging-FollowUp/backend-extensions/routes" -Filter "*.js" -Recurse -ErrorAction SilentlyContinue

$hasErrors = $false

foreach ($file in $routeFiles) {
    Write-Host "Checking: $($file.FullName)" -ForegroundColor Gray
    $result = node -c $file.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Syntax error in $($file.FullName)" -ForegroundColor Red
        Write-Host $result -ForegroundColor Red
        $hasErrors = $true
    } else {
        Write-Host "✅ $($file.Name)" -ForegroundColor Green
    }
}

if ($hasErrors) {
    Write-Host "`n❌ Syntax errors found! Please fix before deploying." -ForegroundColor Red
    exit 1
} else {
    Write-Host "`n✅ All files have valid syntax!" -ForegroundColor Green
    exit 0
}
