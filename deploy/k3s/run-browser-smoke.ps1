param([Parameter(Mandatory=$true)][string]$BackendRepository)
$ErrorActionPreference = 'Stop'
if (Get-Process chrome -ErrorAction SilentlyContinue) { throw 'Close personal Chrome before isolated QA.' }
if (Get-NetTCPConnection -State Listen -LocalPort 18080,19443 -ErrorAction SilentlyContinue) { throw 'QA ports are occupied; no process will be killed.' }
$taskBackendRoot = (Resolve-Path -LiteralPath $BackendRepository).Path
$taskPython = Join-Path $taskBackendRoot '.venv/Scripts/python.exe'
$taskProfile = Join-Path ([IO.Path]::GetTempPath()) ('sptc-phase4a-cdp-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $taskProfile
$taskBackend = $null
$taskOwnedChildren = @()
try {
    $env:RESILIENCE_ASSISTANT_ENABLED = 'true'
    $taskBackend = Start-Process -FilePath $taskPython -WorkingDirectory $taskBackendRoot -ArgumentList @('-m','uvicorn','resilience_agent.api:app','--host','127.0.0.1','--port','18080','--no-access-log') -WindowStyle Hidden -PassThru
    $taskBackendStart = $taskBackend.StartTime.ToUniversalTime()
    $taskBackendPath = $taskBackend.Path
    $taskReady = $false
    for ($attempt=0; $attempt -lt 60; $attempt++) {
        try { $h = Invoke-RestMethod http://127.0.0.1:18080/health; if ($h.status -eq 'ok') { $taskReady=$true; break } } catch { }
        Start-Sleep -Milliseconds 500
    }
    if (!$taskReady) { throw 'QA backend did not become healthy' }
    # Windows virtualenv redirectors may own a real Python child. Record identities,
    # not merely PIDs, before running QA; never enumerate/kill all Python processes.
    $taskOwnedChildren = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $taskBackend.Id } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate)
    $null = Start-Process -FilePath 'C:/Program Files/Google/Chrome/Application/chrome.exe' -WindowStyle Hidden -PassThru -ArgumentList @('--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--disable-extensions','--disable-sync','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',('--user-data-dir="'+$taskProfile+'"'),'--host-resolver-rules="MAP sptc.geos.tamu.edu 127.0.0.1"','about:blank')
    & 'D:/programming/Minicoda/python.exe' (Join-Path $PSScriptRoot 'browser_smoke.py') --isolated-profile $taskProfile
    if ($LASTEXITCODE -ne 0) { throw 'Production-style browser simulation failed' }
} finally {
    if ($taskBackend) {
        $taskParent = Get-Process -Id $taskBackend.Id -ErrorAction SilentlyContinue
        if ($taskParent -and $taskParent.Path -eq $taskBackendPath -and $taskParent.StartTime.ToUniversalTime() -eq $taskBackendStart) {
            $taskOwnedChildren += @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $taskBackend.Id } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate)
        }
    }
    foreach ($taskChild in $taskOwnedChildren) {
        $taskMatch = Get-CimInstance Win32_Process -Filter ('ProcessId='+$taskChild.ProcessId) -ErrorAction SilentlyContinue
        if ($taskMatch -and $taskMatch.ParentProcessId -eq $taskChild.ParentProcessId -and $taskMatch.ExecutablePath -eq $taskChild.ExecutablePath -and $taskMatch.CreationDate -eq $taskChild.CreationDate) {
            Stop-Process -Id $taskChild.ProcessId -ErrorAction SilentlyContinue
        }
    }
    if ($taskBackend) {
        $taskCurrent = Get-Process -Id $taskBackend.Id -ErrorAction SilentlyContinue
        if ($taskCurrent -and $taskCurrent.Path -eq $taskBackendPath -and $taskCurrent.StartTime.ToUniversalTime() -eq $taskBackendStart) {
            Stop-Process -Id $taskCurrent.Id
            $taskCurrent.WaitForExit(10000) | Out-Null
        }
    }
}
