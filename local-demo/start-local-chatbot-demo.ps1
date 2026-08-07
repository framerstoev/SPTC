#requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [switch]$NoBrowser,

    [Parameter(Mandatory = $false)]
    [ValidateRange(80, 180)]
    [int]$WarmupTimeoutSeconds = 120,

    [Parameter(Mandatory = $false)]
    [ValidateRange(10, 60)]
    [int]$ServiceTimeoutSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "lib\LocalDemo.Core.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "lib\LocalDemo.Windows.psm1") -Force

$constants = Get-LocalDemoConstants
$layout = Get-LocalDemoLayout -ScriptRoot $PSScriptRoot
$lifecycleLock = $null
$state = $null
$ollamaPath = $null
$nvidiaSmiPath = $null
$stage = "initialization"
$startupWatch = [Diagnostics.Stopwatch]::StartNew()
$activeExistingState = $null
$preservedExistingSession = $false

function Save-CurrentDemoState {
    Write-DemoState -State $state -StatePath $layout.StatePath
}

function Add-DemoProcessToState {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Record
    )

    $state.processes = @($state.processes) + @($Record)
    Save-CurrentDemoState
}

function Register-FailedDemoHelper {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("ollama_cli", "nvidia_smi")]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [object]$Result
    )

    if ($Result.CleanupFailed -ne $true) {
        return
    }
    $targetState = if ($null -ne $state) {
        $state
    } else {
        $activeExistingState
    }
    if ($null -eq $targetState -or $null -eq $Result.ProcessFact) {
        throw "A launcher helper could not be cleaned up or recorded safely."
    }
    $record = New-DemoProcessRecordFromFact -Role $Role `
        -ProcessFact $Result.ProcessFact -Port 0 -CreatedByLauncher $true
    if (@($targetState.processes | Where-Object { $_.role -eq $Role }).Count -gt 0) {
        throw "A launcher helper role is already recorded and requires safe shutdown."
    }
    $previousProcesses = @($targetState.processes)
    try {
        $targetState.processes = @($previousProcesses) + @($record)
        Write-DemoState -State $targetState -StatePath $layout.StatePath
    } catch {
        $persistenceError = $_.Exception.Message
        $emergencyStop = $null
        try {
            $emergencyStop = Stop-DemoOwnedProcess -Record $record -GraceSeconds 1
        } catch {
            $emergencyStop = [pscustomobject]@{
                Stopped = $false
                Reason = "stop_threw"
            }
        }
        if ($emergencyStop.Stopped -or $emergencyStop.Reason -in @(
                "already_stopped", "identity_mismatch_or_absent"
            )) {
            $targetState.processes = @($previousProcesses)
            throw "A launcher helper state write failed after the helper was stopped: $persistenceError"
        }
        try {
            Write-DemoState -State $targetState -StatePath $layout.StatePath
        } catch {
            throw (
                "A launcher helper could neither be stopped nor durably recorded. " +
                "PID $($record.process_id) requires manual inspection."
            )
        }
        throw "A launcher helper remains durably recorded after cleanup failed."
    }
    $retry = Stop-DemoOwnedProcess -Record $record -GraceSeconds 1
    if ($retry.Stopped -or $retry.Reason -in @(
            "already_stopped", "identity_mismatch_or_absent"
        )) {
        $withRecord = @($targetState.processes)
        try {
            $targetState.processes = @($withRecord | Where-Object {
                    [int]$_.process_id -ne [int]$record.process_id
                })
            Write-DemoState -State $targetState -StatePath $layout.StatePath
        } catch {
            $targetState.processes = @($withRecord)
            throw
        }
    }
}

function Add-StartedServiceRecords {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [System.Diagnostics.Process]$LaunchProcess,
        [Parameter(Mandatory = $true)]
        [object]$ListenerFact,
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$StandardOutputLog,
        [Parameter(Mandatory = $true)]
        [string]$StandardErrorLog
    )

    $launcherRole = "${Role}_launcher"
    $listenerIsLauncher = [int]$ListenerFact.ProcessId -eq [int]$LaunchProcess.Id
    $serviceRecord = New-DemoProcessRecordFromFact -Role $Role `
        -ProcessFact $ListenerFact -Port $Port -CreatedByLauncher $true `
        -LauncherProcessId $(if ($listenerIsLauncher) {
            $null
        } else {
            [int]$LaunchProcess.Id
        }) `
        -StandardOutputLog $StandardOutputLog -StandardErrorLog $StandardErrorLog
    $previousProcesses = @($state.processes)
    $nextProcesses = if ($listenerIsLauncher) {
        @($previousProcesses | Where-Object { $_.role -ne $launcherRole }) +
            @($serviceRecord)
    } else {
        @($previousProcesses) + @($serviceRecord)
    }
    try {
        $state.processes = @($nextProcesses)
        Save-CurrentDemoState
    } catch {
        $state.processes = @($previousProcesses)
        throw
    }
}

function Start-TrackedDemoProcess {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("ollama", "backend", "frontend")]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$ArgumentList,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [hashtable]$Environment,
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$StandardOutputLog,
        [Parameter(Mandatory = $true)]
        [string]$StandardErrorLog
    )

    $process = $null
    $fact = $null
    $logDirectory = Split-Path -Parent $StandardOutputLog
    $startGatePath = Join-Path $logDirectory "$Role.start.gate"
    $startGateToken = [guid]::NewGuid().ToString("D")
    try {
        $process = Start-DemoSupervisedProcess `
            -SupervisorPython $layout.BackendSupervisorPython `
            -SupervisorScript (Join-Path $PSScriptRoot "supervise_service.py") `
            -ServiceFilePath $FilePath -ServiceArguments $ArgumentList `
            -WorkingDirectory $WorkingDirectory -Environment $Environment `
            -StandardOutputLog $StandardOutputLog `
            -StandardErrorLog $StandardErrorLog `
            -StartGatePath $startGatePath -StartGateToken $startGateToken
        $fact = Get-DemoProcessFact -ProcessId $process.Id
        if ($null -eq $fact) {
            throw "The newly created $Role process identity could not be captured."
        }
        $record = New-DemoProcessRecordFromFact -Role "${Role}_launcher" `
            -ProcessFact $fact -Port $Port -CreatedByLauncher $true `
            -StandardOutputLog $StandardOutputLog -StandardErrorLog $StandardErrorLog
        Add-DemoProcessToState -Record $record
        Open-DemoSupervisorGate -GatePath $startGatePath `
            -Token $startGateToken -LogDirectory $logDirectory `
            -LogsRoot $layout.LogsRoot
        return $process
    } catch {
        $cleanupFailed = $false
        if ($null -ne $process) {
            try {
                if (-not $process.HasExited) {
                    [void]$process.CloseMainWindow()
                    if (-not $process.WaitForExit(1000)) {
                        $process.Kill()
                    }
                    if (-not $process.WaitForExit(2000)) {
                        throw "The just-created process did not exit after termination."
                    }
                }
            } catch {
                $cleanupFailed = $true
            }
        }
        if ($cleanupFailed) {
            if ($null -eq $fact -and $null -ne $process) {
                try {
                    $fact = [pscustomobject]@{
                        ProcessId = [int]$process.Id
                        ProcessName = "python"
                        ExecutablePath = [System.IO.Path]::GetFullPath(
                            $layout.BackendSupervisorPython
                        )
                        StartTimeUtc = $process.StartTime.ToUniversalTime().ToString("o")
                    }
                } catch {
                    $fact = $null
                }
            }
            if ($null -eq $fact) {
                throw "A just-created process could not be cleaned up or recorded safely."
            }
            if (@($state.processes | Where-Object {
                        [int]$_.process_id -eq [int]$fact.ProcessId
                    }).Count -eq 0) {
                $emergencyRecord = New-DemoProcessRecordFromFact `
                    -Role "${Role}_launcher" -ProcessFact $fact -Port $Port `
                    -CreatedByLauncher $true `
                    -StandardOutputLog $StandardOutputLog `
                    -StandardErrorLog $StandardErrorLog
                Add-DemoProcessToState -Record $emergencyRecord
            }
            Write-Warning "A just-created process remains recorded for rollback."
        }
        throw
    }
}

function Invoke-LaunchFailureRollback {
    if ($null -eq $state) {
        return $true
    }

    $stopAction = {
        param($record)
        if ($record.role -eq "ollama" -and
            ([string]::IsNullOrWhiteSpace($ollamaPath) -or
                (ConvertTo-NormalizedDemoPath $record.executable_path) -ne
                (ConvertTo-NormalizedDemoPath $ollamaPath))) {
            return [pscustomobject]@{
                Stopped = $false
                Reason = "ollama_executable_not_authorized"
            }
        }
        if ($record.role -eq "ollama_launcher" -and
            ((ConvertTo-NormalizedDemoPath $record.executable_path) -ne
                (ConvertTo-NormalizedDemoPath $layout.BackendSupervisorPython))) {
            return [pscustomobject]@{
                Stopped = $false
                Reason = "ollama_supervisor_executable_not_authorized"
            }
        }
        if ($record.role -eq "ollama_cli" -and
            ([string]::IsNullOrWhiteSpace($ollamaPath) -or
                (ConvertTo-NormalizedDemoPath $record.executable_path) -ne
                (ConvertTo-NormalizedDemoPath $ollamaPath))) {
            return [pscustomobject]@{
                Stopped = $false
                Reason = "ollama_cli_executable_not_authorized"
            }
        }
        if ($record.role -eq "nvidia_smi" -and
            ([string]::IsNullOrWhiteSpace($nvidiaSmiPath) -or
                (ConvertTo-NormalizedDemoPath $record.executable_path) -ne
                (ConvertTo-NormalizedDemoPath $nvidiaSmiPath))) {
            return [pscustomobject]@{
                Stopped = $false
                Reason = "nvidia_smi_executable_not_authorized"
            }
        }
        if ($record.role -in @("ollama", "backend", "frontend") -and
            $null -ne $record.launcher_process_id) {
            try {
                Assert-DemoChildServiceLink -Record $record -State $state
            } catch {
                return [pscustomobject]@{
                    Stopped = $false
                    Reason = "child_service_identity_mismatch"
                }
            }
        }
        $result = Stop-DemoOwnedProcess -Record $record
        Remove-DemoClearedTransientProcessRecord -State $state -Record $record `
            -StopResult $result -StatePath $layout.StatePath
        $result
    }.GetNewClosure()
    $unloadAction = {
        param($currentState)
        if ([string]::IsNullOrWhiteSpace($ollamaPath)) {
            return [pscustomobject]@{
                Attempted = $false
                Succeeded = $false
                Reason = "ollama_executable_unavailable"
            }
        }
        $ollamaRecord = @($currentState.processes | Where-Object {
                $_.role -eq "ollama"
            }) | Select-Object -First 1
        if ($null -eq $ollamaRecord) {
            return [pscustomobject]@{
                Attempted = $false
                Succeeded = $false
                Reason = "ollama_service_not_recorded"
            }
        }
        try {
            $unload = Invoke-DemoVerifiedModelUnload -OllamaRecord $ollamaRecord `
                    -State $currentState -OllamaPath $ollamaPath `
                    -ModelName $constants.ModelName
            Register-FailedDemoHelper -Role "ollama_cli" `
                -Result $unload.CommandResult
            if (-not $unload.Succeeded) {
                throw "The bounded Ollama model-unload command failed."
            }
            return [pscustomobject]@{
                Attempted = $true
                Succeeded = $true
                Reason = "unloaded"
            }
        } catch {
            Write-Warning "The launcher could not safely unload qwen3:8b during rollback."
            return [pscustomobject]@{
                Attempted = $true
                Succeeded = $false
                Reason = $_.Exception.Message
            }
        }
    }.GetNewClosure()
    $shutdown = Invoke-DemoShutdownSequence -State $state `
        -StopProcessAction $stopAction -UnloadModelAction $unloadAction
    if ($shutdown.OllamaShutdownDeferred) {
        Write-Warning (
            "Rollback preserved Ollama because an upstream launcher-owned process " +
            "could not be confirmed stopped."
        )
    }
    foreach ($entry in @($shutdown.ProcessResults)) {
        $record = $entry.Record
        $result = $entry.Result
        if (-not $result.Stopped -and $result.Reason -notin @(
                "already_stopped", "identity_mismatch_or_absent"
            )) {
            Write-Warning (
                "Rollback did not stop launcher-owned role {0}: {1}" -f
                $record.role, $result.Reason
            )
        }
    }

    $remainingOwned = @()
    foreach ($record in @($state.processes | Where-Object {
                $_.created_by_launcher -eq $true
            })) {
        $actual = Get-DemoProcessFact -ProcessId ([int]$record.process_id)
        if (Test-DemoProcessIdentity -Record $record -ActualProcess $actual) {
            $remainingOwned += $record
        }
    }
    if ($remainingOwned.Count -eq 0 -and
        (Test-Path -LiteralPath $layout.StatePath -PathType Leaf)) {
        Remove-Item -LiteralPath $layout.StatePath -Force
    }
    if ($remainingOwned.Count -eq 0 -and
        -not [string]::IsNullOrWhiteSpace([string]$state.log_directory)) {
        Limit-DemoSessionLogs -LogDirectory $state.log_directory `
            -LogsRoot $layout.LogsRoot
    }
    $remainingOwned.Count -eq 0
}

try {
    Initialize-DemoRuntime -Layout $layout
    $lifecycleLock = Enter-DemoLifecycleLock -LockPath $layout.LockPath

    $stage = "existing session check"
    $existingState = Read-DemoState -StatePath $layout.StatePath -Layout $layout
    if ($null -ne $existingState) {
        $actualMap = Get-DemoActualProcessMap -Records @($existingState.processes)
        $disposition = Get-DemoSessionDisposition -State $existingState `
            -ActualProcesses $actualMap
        if ($disposition -eq "active") {
            $activeExistingState = $existingState
            $preservedExistingSession = $true
        }
        if ($disposition -eq "partial") {
            $preservedExistingSession = $true
            throw (
                "A partial launcher-owned session is still active. Run the stop script " +
                "before starting another session."
            )
        }
        if ($disposition -eq "stale") {
            Limit-DemoSessionLogs -LogDirectory $existingState.log_directory `
                -LogsRoot $layout.LogsRoot
            Remove-Item -LiteralPath $layout.StatePath -Force
            Write-Host "Removed a stale launcher state file; no recorded process identity matched."
        }
    }

    $stage = "Windows PowerShell verification"
    Assert-WindowsPowerShellCompatibility -PowerShellInfo (Get-DemoPowerShellInfo)

    $stage = "repository and executable pre-flight"
    $requiredPaths = @(
        @($layout.FrontendRepository, "Container", "Frontend repository"),
        @($layout.BackendRepository, "Container", "Backend repository"),
        @($layout.BackendVenvConfig, "Leaf", "Backend virtual-environment config"),
        @($layout.BackendPython, "Leaf", "Backend virtual-environment Python"),
        @($layout.BackendSupervisorPython, "Leaf", "Backend base Python"),
        @($layout.BackendUvicorn, "Leaf", "Backend virtual-environment Uvicorn"),
        @($layout.SnapshotDirectory, "Container", "Reviewed backend snapshot")
    )
    foreach ($entry in $requiredPaths) {
        Assert-RequiredDemoPath -Path $entry[0] -PathType $entry[1] `
            -Label $entry[2] -Exists (Test-Path -LiteralPath $entry[0] `
                -PathType $entry[1])
    }
    $gitPath = Resolve-DemoExecutable -CommandName "git.exe"
    Assert-DemoRepositoryCheckpoints -Layout $layout -GitPath $gitPath

    $ollamaCandidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $ollamaCandidates += Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    }
    $ollamaPath = Resolve-DemoExecutable -CommandName "ollama.exe" `
        -Candidates $ollamaCandidates
    $modelManifest = Get-DemoOllamaManifestPath -ModelName $constants.ModelName
    Assert-RequiredDemoPath -Path $modelManifest -PathType Leaf `
        -Label "Installed qwen3:8b manifest" `
        -Exists (Test-Path -LiteralPath $modelManifest -PathType Leaf)

    if ($null -eq $activeExistingState) {
        $sessionId = [guid]::NewGuid().ToString("D")
        $logDirectory = Join-Path $layout.LogsRoot $sessionId
        [void](New-Item -ItemType Directory -Path $logDirectory -Force)
        Remove-OldDemoLogSessions -LogsRoot $layout.LogsRoot `
            -ActiveDirectory $logDirectory
        $state = New-DemoState -SessionId $sessionId `
            -CreatedAtUtc ([DateTime]::UtcNow.ToString("o")) `
            -LogDirectory $logDirectory
        Save-CurrentDemoState
    }

    $stage = "NVIDIA GPU verification"
    $nvidiaCandidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:windir)) {
        $nvidiaCandidates += Join-Path $env:windir "System32\nvidia-smi.exe"
    }
    $nvidiaSmiPath = Resolve-DemoExecutable -CommandName "nvidia-smi.exe" `
        -Candidates $nvidiaCandidates
    $initialNvidia = Invoke-DemoNvidiaSmi -NvidiaSmiPath $nvidiaSmiPath
    Register-FailedDemoHelper -Role "nvidia_smi" -Result $initialNvidia
    $gpu = Assert-DemoGpuFacts -Controllers (Get-DemoGpuControllers) `
        -NvidiaSmiExitCode $initialNvidia.ExitCode -NvidiaRows $initialNvidia.Rows
    Write-Host (
        "GPU verified: {0}, status OK, Code 0, driver {1}." -f
        $gpu.Name, $gpu.DriverVersion
    )

    if ($null -ne $activeExistingState) {
        $stage = "existing ready-session verification"
        foreach ($role in @("ollama", "backend", "frontend")) {
            $record = @($activeExistingState.processes | Where-Object {
                    $_.role -eq $role
                }) | Select-Object -First 1
            [void](Assert-DemoRecordedServiceIdentity -Record $record)
            Assert-DemoChildServiceLink -Record $record `
                -State $activeExistingState
        }
        $ollamaRecord = @($activeExistingState.processes | Where-Object {
                $_.role -eq "ollama"
            }) | Select-Object -First 1
        if ((ConvertTo-NormalizedDemoPath $ollamaRecord.executable_path) -ne
            (ConvertTo-NormalizedDemoPath $ollamaPath)) {
            throw "The active session Ollama executable no longer matches."
        }
        $version = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/version" `
            -TimeoutSeconds $ServiceTimeoutSeconds
        if ($version.HttpStatus -ne 200 -or
            [string]::IsNullOrWhiteSpace([string]$version.Body.version)) {
            throw "The active session Ollama API is unavailable."
        }
        $tags = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/tags" `
            -TimeoutSeconds $ServiceTimeoutSeconds
        if ($tags.HttpStatus -ne 200 -or
            -not (Test-DemoModelInstalledFromApi -TagsBody $tags.Body `
                -ModelName $constants.ModelName)) {
            throw "The active session no longer has the fixed qwen3:8b model installed."
        }
        $ollamaPs = Invoke-DemoOllamaCommand -OllamaPath $ollamaPath `
            -Arguments @("ps")
        Register-FailedDemoHelper -Role "ollama_cli" -Result $ollamaPs
        if ($ollamaPs.TimedOut -or $ollamaPs.CleanupFailed -or
            $ollamaPs.ExitCode -ne 0) {
            throw "The active session Ollama status command failed."
        }
        $allocation = Get-DemoOllamaAllocation -Output $ollamaPs.Output `
            -ModelName $constants.ModelName
        $health = Wait-DemoHttpJson -Url "$($constants.BackendUrl)/health" `
            -TimeoutSeconds $ServiceTimeoutSeconds
        Assert-DemoBackendHealth -Health $health
        $frontendStatus = Wait-DemoHttpStatus -Url $constants.BrowserUrl `
            -TimeoutSeconds $ServiceTimeoutSeconds
        Assert-DemoFrontendResponse -HttpStatus $frontendStatus
        if (-not $NoBrowser) {
            Open-DemoBrowser -Url $constants.BrowserUrl
        }
        Write-Host "The launcher-owned local demo is already running and healthy."
        Write-Host "Browser: $($activeExistingState.browser_url)"
        Write-Host "Model: $($constants.ModelName) ($allocation)"
        Write-Host (
            "Stop with: powershell.exe -NoProfile -File `"{0}`"" -f
            (Join-Path $PSScriptRoot "stop-local-chatbot-demo.ps1")
        )
        return
    }

    $stage = "required port pre-flight"
    [void](Resolve-DemoPortPolicy -Port 8001 `
            -Listeners @(Get-DemoPortListeners -Port 8001))
    [void](Resolve-DemoPortPolicy -Port 8080 `
            -Listeners @(Get-DemoPortListeners -Port 8080))
    $ollamaPolicy = Resolve-DemoPortPolicy -Port 11434 `
        -Listeners @(Get-DemoPortListeners -Port 11434) `
        -ExpectedOllamaPath $ollamaPath
    if ($ollamaPolicy.Disposition -eq "free") {
        $unboundOllamaProcesses = @(Get-DemoOllamaProcessFacts)
        if ($unboundOllamaProcesses.Count -gt 0) {
            $owners = ($unboundOllamaProcesses | ForEach-Object {
                    $_.ProcessId
                }) -join ","
            throw (
                "Ollama process PID $owners exists without a verified " +
                "127.0.0.1:11434 listener. Close or inspect it manually; the launcher " +
                "will not terminate a user-owned process."
            )
        }
    }

    $ollamaStdout = Join-Path $logDirectory "ollama.stdout.log"
    $ollamaStderr = Join-Path $logDirectory "ollama.stderr.log"
    if ($ollamaPolicy.Disposition -eq "preexisting_ollama") {
        $state.ollama_preexisting = $true
        $ollamaFact = Get-DemoProcessFact -ProcessId $ollamaPolicy.ProcessId
        $ollamaRecord = New-DemoProcessRecordFromFact -Role "ollama" `
            -ProcessFact $ollamaFact -Port 11434 -CreatedByLauncher $false
        Add-DemoProcessToState -Record $ollamaRecord
        Write-Host "Using the verified pre-existing loopback-only Ollama service."
    } else {
        $stage = "Ollama loopback startup"
        $ollamaLaunch = Start-TrackedDemoProcess -Role "ollama" `
            -FilePath $ollamaPath `
            -ArgumentList @("serve") -WorkingDirectory $layout.DemoRoot `
            -Environment @{ OLLAMA_HOST = "127.0.0.1:11434" } `
            -Port 11434 `
            -StandardOutputLog $ollamaStdout -StandardErrorLog $ollamaStderr
        $ollamaLaunchRecord = @($state.processes | Where-Object {
                $_.role -eq "ollama_launcher"
            }) | Select-Object -Last 1
        $ollamaListenerFact = Wait-DemoOwnedListener -Port 11434 `
            -LaunchRecord $ollamaLaunchRecord -TimeoutSeconds $ServiceTimeoutSeconds
        Add-StartedServiceRecords -Role "ollama" -LaunchProcess $ollamaLaunch `
            -ListenerFact $ollamaListenerFact -Port 11434 `
            -StandardOutputLog $ollamaStdout -StandardErrorLog $ollamaStderr
        [void](Resolve-DemoPortPolicy -Port 11434 `
                -Listeners @(Get-DemoPortListeners -Port 11434) `
                -ExpectedOllamaPath $ollamaPath)
        Write-Host "Started launcher-owned Ollama on 127.0.0.1:11434."
    }

    $stage = "Ollama API and installed-model verification"
    $version = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/version" `
        -TimeoutSeconds $ServiceTimeoutSeconds
    if ($version.HttpStatus -ne 200 -or
        [string]::IsNullOrWhiteSpace([string]$version.Body.version)) {
        throw "The verified loopback Ollama API did not return its version contract."
    }
    $tags = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/tags" `
        -TimeoutSeconds $ServiceTimeoutSeconds
    if ($tags.HttpStatus -ne 200 -or
        -not (Test-DemoModelInstalledFromApi -TagsBody $tags.Body `
            -ModelName $constants.ModelName)) {
        throw "qwen3:8b is not installed. The launcher will not pull it automatically."
    }
    $residentBefore = Invoke-DemoOllamaCommand -OllamaPath $ollamaPath `
        -Arguments @("ps")
    Register-FailedDemoHelper -Role "ollama_cli" -Result $residentBefore
    if ($residentBefore.TimedOut -or $residentBefore.CleanupFailed -or
        $residentBefore.ExitCode -ne 0) {
        throw "The verified Ollama service did not return process status."
    }
    $state.model_preexisting_resident = (
        $residentBefore.Output -match
        ("(?m)^\s*" + [regex]::Escape($constants.ModelName) + "\s+")
    )
    $state.model_loaded_by_launcher = -not $state.model_preexisting_resident
    Save-CurrentDemoState

    $ollamaRecordForWarmup = @($state.processes | Where-Object {
            $_.role -eq "ollama"
        }) | Select-Object -First 1
    [void](Assert-DemoOllamaServiceIdentity -Record $ollamaRecordForWarmup)

    $stage = "qwen3:8b explicit warm-up"
    Write-Host "Warming qwen3:8b before any browser question is allowed..."
    $backendEnvironment = Get-DemoBackendEnvironment `
        -SnapshotDirectory $layout.SnapshotDirectory
    $warmupStdout = Join-Path $logDirectory "warmup.stdout.log"
    $warmupStderr = Join-Path $logDirectory "warmup.stderr.log"
    $warmupGate = Join-Path $logDirectory "warmup.start.gate"
    $registerWarmup = {
        param($processFact)
        $record = New-DemoProcessRecordFromFact -Role "warmup" `
            -ProcessFact $processFact -Port 0 -CreatedByLauncher $true `
            -StandardOutputLog $warmupStdout -StandardErrorLog $warmupStderr
        $previousProcesses = @($state.processes)
        try {
            $state.processes = @($previousProcesses) + @($record)
            Write-DemoState -State $state -StatePath $layout.StatePath
        } catch {
            $state.processes = @($previousProcesses)
            throw
        }
    }.GetNewClosure()
    $unregisterWarmup = {
        param($processFact)
        $previousProcesses = @($state.processes)
        try {
            $state.processes = @($previousProcesses | Where-Object {
                    -not ($_.role -eq "warmup" -and
                        [int]$_.process_id -eq [int]$processFact.ProcessId)
                })
            Write-DemoState -State $state -StatePath $layout.StatePath
        } catch {
            $state.processes = @($previousProcesses)
            throw
        }
    }.GetNewClosure()
    $warmup = Invoke-DemoBoundedProcess `
        -SupervisorPython $layout.BackendSupervisorPython `
        -SupervisorScript (Join-Path $PSScriptRoot "supervise_service.py") `
        -FilePath $layout.BackendPython `
        -ArgumentList @("-m", "resilience_agent.assistant_warmup") `
        -WorkingDirectory $layout.BackendRepository `
        -Environment $backendEnvironment -StandardOutputLog $warmupStdout `
        -StandardErrorLog $warmupStderr -TimeoutSeconds $WarmupTimeoutSeconds `
        -StartGatePath $warmupGate -LogDirectory $logDirectory `
        -LogsRoot $layout.LogsRoot -RegisterProcessAction $registerWarmup `
        -UnregisterProcessAction $unregisterWarmup
    if ($warmup.CleanupFailed) {
        throw "The timed-out warm-up process could not be terminated safely."
    }
    $warmupSeconds = Assert-DemoWarmupResult -ExitCode $warmup.ExitCode `
        -StandardOutput $warmup.StandardOutput -TimedOut $warmup.TimedOut
    $state.warmup_seconds = $warmupSeconds
    Save-CurrentDemoState
    Write-Host ("Warm-up READY in {0:N3} seconds." -f $warmupSeconds)

    $stage = "GPU allocation verification"
    [void](Assert-DemoOllamaServiceIdentity -Record $ollamaRecordForWarmup)
    Assert-DemoChildServiceLink -Record $ollamaRecordForWarmup -State $state
    $ollamaPs = Invoke-DemoOllamaCommand -OllamaPath $ollamaPath -Arguments @("ps")
    Register-FailedDemoHelper -Role "ollama_cli" -Result $ollamaPs
    if ($ollamaPs.TimedOut -or $ollamaPs.CleanupFailed -or
        $ollamaPs.ExitCode -ne 0) {
        throw "ollama ps failed after warm-up."
    }
    $allocation = Get-DemoOllamaAllocation -Output $ollamaPs.Output `
        -ModelName $constants.ModelName
    $postWarmNvidia = Invoke-DemoNvidiaSmi -NvidiaSmiPath $nvidiaSmiPath
    Register-FailedDemoHelper -Role "nvidia_smi" -Result $postWarmNvidia
    $gpuAfterWarmup = Assert-DemoGpuFacts -Controllers (Get-DemoGpuControllers) `
        -NvidiaSmiExitCode $postWarmNvidia.ExitCode `
        -NvidiaRows $postWarmNvidia.Rows
    $state.gpu_allocation = $allocation
    $state.gpu_vram_used_mib = [int]$gpuAfterWarmup.UsedMiB
    Save-CurrentDemoState

    $stage = "FastAPI startup"
    $backendStdout = Join-Path $logDirectory "backend.stdout.log"
    $backendStderr = Join-Path $logDirectory "backend.stderr.log"
    $backendLaunch = Start-TrackedDemoProcess -Role "backend" `
        -FilePath $layout.BackendUvicorn `
        -ArgumentList @(
            "resilience_agent.api:app", "--host", "127.0.0.1", "--port", "8080",
            "--log-level", "warning", "--no-access-log"
        ) `
        -WorkingDirectory $layout.BackendRepository `
        -Environment $backendEnvironment -StandardOutputLog $backendStdout `
        -StandardErrorLog $backendStderr -Port 8080
    $backendLaunchRecord = @($state.processes | Where-Object {
            $_.role -eq "backend_launcher"
        }) | Select-Object -Last 1
    $backendListenerFact = Wait-DemoOwnedListener -Port 8080 `
        -LaunchRecord $backendLaunchRecord -TimeoutSeconds $ServiceTimeoutSeconds
    Add-StartedServiceRecords -Role "backend" -LaunchProcess $backendLaunch `
        -ListenerFact $backendListenerFact -Port 8080 `
        -StandardOutputLog $backendStdout -StandardErrorLog $backendStderr
    $health = Wait-DemoHttpJson -Url "$($constants.BackendUrl)/health" `
        -TimeoutSeconds $ServiceTimeoutSeconds
    Assert-DemoBackendHealth -Health $health

    $stage = "frontend startup"
    $frontendStdout = Join-Path $logDirectory "frontend.stdout.log"
    $frontendStderr = Join-Path $logDirectory "frontend.stderr.log"
    $frontendLaunch = Start-TrackedDemoProcess -Role "frontend" `
        -FilePath $layout.BackendPython `
        -ArgumentList @("-m", "http.server", "8001", "--bind", "127.0.0.1") `
        -WorkingDirectory $layout.FrontendRepository -Environment @{
            PYTHONUNBUFFERED = "1"
        } -StandardOutputLog $frontendStdout -StandardErrorLog $frontendStderr `
        -Port 8001
    $frontendLaunchRecord = @($state.processes | Where-Object {
            $_.role -eq "frontend_launcher"
        }) | Select-Object -Last 1
    $frontendListenerFact = Wait-DemoOwnedListener -Port 8001 `
        -LaunchRecord $frontendLaunchRecord -TimeoutSeconds $ServiceTimeoutSeconds
    Add-StartedServiceRecords -Role "frontend" -LaunchProcess $frontendLaunch `
        -ListenerFact $frontendListenerFact -Port 8001 `
        -StandardOutputLog $frontendStdout -StandardErrorLog $frontendStderr
    $frontendStatus = Wait-DemoHttpStatus -Url $constants.BrowserUrl `
        -TimeoutSeconds $ServiceTimeoutSeconds
    Assert-DemoFrontendResponse -HttpStatus $frontendStatus

    $state.status = "ready"
    $state.ready_at_utc = [DateTime]::UtcNow.ToString("o")
    $state.startup_seconds = [Math]::Round($startupWatch.Elapsed.TotalSeconds, 3)
    Save-CurrentDemoState

    $stage = "browser open"
    if (-not $NoBrowser) {
        Open-DemoBrowser -Url $constants.BrowserUrl
    }
    Write-Host ""
    Write-Host "Jason local chatbot demo is READY."
    Write-Host "Browser: $($constants.BrowserUrl)"
    Write-Host "GPU: $($gpuAfterWarmup.Name), status OK, Code 0"
    Write-Host "Model: $($constants.ModelName) ($allocation)"
    Write-Host "VRAM used: $($gpuAfterWarmup.UsedMiB) MiB"
    Write-Host "FastAPI: $($constants.BackendUrl)"
    Write-Host "Frontend: http://127.0.0.1:8001"
    Write-Host "Startup: $($state.startup_seconds) seconds"
    Write-Host "Logs: $logDirectory"
    Write-Host (
        "Stop: powershell.exe -NoProfile -File `"{0}`"" -f
        (Join-Path $PSScriptRoot "stop-local-chatbot-demo.ps1")
    )
} catch {
    $failureMessage = $_.Exception.Message
    Write-Warning "Local demo startup failed during: $stage"
    Write-Warning $failureMessage
    if ($preservedExistingSession -and $null -eq $state) {
        throw (
            "The existing launcher session was preserved and no service was stopped. " +
            "Use the status command to inspect it or the stop command to clean it up safely."
        )
    }
    $rollbackComplete = Invoke-LaunchFailureRollback
    if ($rollbackComplete) {
        throw "The local demo was not started. Launcher-owned processes were rolled back."
    }
    throw (
        "The local demo was not started, and verified launcher-owned processes " +
        "remain. State and active logs were preserved for a safe stop retry."
    )
} finally {
    if ($null -ne $lifecycleLock) {
        $lifecycleLock.Dispose()
    }
}
