while ($true) {
    Set-Location "C:\Users\toufik\skillbridge"

    $status = git status --porcelain

    if ([string]::IsNullOrWhiteSpace($status)) {
        git pull origin main
    }
    else {
        Write-Host "Local changes detected. Skipping pull..."
    }

    Start-Sleep -Seconds 10
}