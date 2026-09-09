$git = "C:\Program Files\Git\cmd\git.exe"

Write-Host "Uploading to GitHub..." -ForegroundColor Cyan

& $git add -A

$status = & $git status --porcelain

if (-not $status) {
    Write-Host "No changes to upload." -ForegroundColor Yellow
    exit 0
}

& $git commit -m "Update project"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Commit failed!" -ForegroundColor Red
    exit 1
}

& $git pull --rebase origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "Pull/Rebase failed. Please resolve the conflict." -ForegroundColor Red
    exit 1
}

& $git push origin main

if ($LASTEXITCODE -ne 0) {
    Write-Host "Push failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Successfully uploaded to GitHub!" -ForegroundColor Green