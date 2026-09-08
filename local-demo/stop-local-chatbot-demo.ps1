#requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 10)]
    [int]$GraceSeconds = 3,

    [Parameter(DontShow = $true)]
    [ValidateSet("v2", "v3")]
    [string]$LauncherProfile = "v2"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "lib\LocalDemo.Core.psm1") -Force -ArgumentList $LauncherProfile
Import-Module (Join-Path $PSScriptRoot "lib\LocalDemo.Windows.psm1") -Force -ArgumentList $LauncherProfile

$constants = Get-LocalDemoConstants
$layout = Get-LocalDemoLayout -ScriptRoot $PSScriptRoot
$lifecycleLock = $null
$state = $null

function Register-FailedStopHelper {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [object]$Result
    )

    if ($Result.CleanupFailed -ne $true) {
        return
    }
    if ($null -eq $state -or $null -eq $Result.ProcessFact) {
        throw "A shutdown helper could not be cleaned up or recorded safely."
    }
    $record = New-DemoProcessRecordFromFact -Role $Role `
        -ProcessFact $Result.ProcessFact -Port 0 -CreatedByLauncher $true
    if (@($state.processes | Where-Object { $_.role -eq $Role }).Count -gt 0) {
        throw "A shutdown helper role is already recorded and requires a safe retry."
    }
    $previousProcesses = @($state.processes)
    try {
        $state.processes = @($previousProcesses) + @($record)
        Write-DemoState -State $state -StatePath $layout.StatePath
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
            $state.processes = @($previousProcesses)
            throw "A shutdown helper state write failed after the helper was stopped: $persistenceError"
        }
        try {
            Write-DemoState -State $state -StatePath $layout.StatePath
        } catch {
            throw (
                "A shutdown helper could neither be stopped nor durably recorded. " +
                "PID $($record.process_id) requires manual inspection."
            )
        }
        throw "A shutdown helper remains durably recorded after cleanup failed."
    }
    $retry = Stop-DemoOwnedProcess -Record $record -GraceSeconds 1
    if ($retry.Stopped -or $retry.Reason -in @(
            "already_stopped", "identity_mismatch_or_absent"
        )) {
        $withRecord = @($state.processes)
        try {
            $state.processes = @($withRecord | Where-Object {
                    [int]$_.process_id -ne [int]$record.process_id
                })
            Write-DemoState -State $state -StatePath $layout.StatePath
        } catch {
            $state.processes = @($withRecord)
            throw
        }
    }
}

function Write-CurrentPortStatus {
    $frontendListeners = @(Get-DemoPortListeners -Port 8001)
    $backendListeners = @(Get-DemoPortListeners -Port 8080)
    $ollamaListeners = @(Get-DemoPortListeners -Port 11434)

    if ($frontendListeners.Count -eq 0) {
        Write-Host "Port 8001: free"
    } else {
        Write-Warning (
            "Port 8001 remains occupied by PID {0}; it was not stopped because it " +
            "is not verified launcher-owned state." -f
            (($frontendListeners | ForEach-Object { $_.ProcessId } | Select-Object -Unique) -join ",")
        )
    }
    if ($backendListeners.Count -eq 0) {
        Write-Host "Port 8080: free"
    } else {
        Write-Warning (
            "Port 8080 remains occupied by PID {0}; it was not stopped because it " +
            "is not verified launcher-owned state." -f
            (($backendListeners | ForEach-Object { $_.ProcessId } | Select-Object -Unique) -join ",")
        )
    }
    if ($ollamaListeners.Count -eq 0) {
        Write-Host "Port 11434: stopped/free"
    } else {
        $addresses = ($ollamaListeners | ForEach-Object { $_.Address } | Select-Object -Unique) -join ","
        $owners = ($ollamaListeners | ForEach-Object { $_.ProcessId } | Select-Object -Unique) -join ","
        if (@($ollamaListeners | Where-Object { $_.Address -ne "127.0.0.1" }).Count -eq 0) {
            Write-Host "Port 11434: loopback listener remains (PID $owners); not launcher-owned."
        } else {
            Write-Warning "Port 11434 remains on address $addresses (PID $owners); no process was stopped."
        }
    }
    [pscustomobject]@{
        FrontendFree = ($frontendListeners.Count -eq 0)
        BackendFree = ($backendListeners.Count -eq 0)
    }
}

try {
    Initialize-DemoRuntime -Layout $layout
    $lifecycleLock = Enter-DemoLifecycleLock -LockPath $layout.LockPath
    $state = Read-DemoState -StatePath $layout.StatePath -Layout $layout
    if ($null -eq $state) {
        Write-Host "No launcher-owned local demo session is recorded; already stopped."
        $ports = Write-CurrentPortStatus
        if (-not $ports.FrontendFree -or -not $ports.BackendFree) {
            throw "Required demo ports are occupied by processes the launcher does not own."
        }
        return
    }

    if ($state.model_preexisting_resident -eq $true) {
        Write-Host "Leaving the pre-existing qwen3:8b residency unchanged."
    }

    $ollamaCandidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        $ollamaCandidates += Join-Path $env:LOCALAPPDATA `
            "Programs\Ollama\ollama.exe"
    }
    $ollamaPath = $null
    try {
        $ollamaPath = Resolve-DemoExecutable -CommandName "ollama.exe" `
            -Candidates $ollamaCandidates
    } catch {
        Write-Warning (
            "The installed Ollama executable could not be resolved. Any recorded " +
            "launcher-owned Ollama process will be preserved for safety."
        )
    }
    $nvidiaCandidates = @()
    if (-not [string]::IsNullOrWhiteSpace($env:windir)) {
        $nvidiaCandidates += Join-Path $env:windir "System32\nvidia-smi.exe"
    }
    $nvidiaSmiPath = $null
    try {
        $nvidiaSmiPath = Resolve-DemoExecutable -CommandName "nvidia-smi.exe" `
            -Candidates $nvidiaCandidates
    } catch {
        Write-Warning (
            "nvidia-smi could not be resolved. Any recorded launcher-owned helper " +
            "will be preserved for safety."
        )
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
        $result = Stop-DemoOwnedProcess -Record $record -GraceSeconds $GraceSeconds
        Remove-DemoClearedTransientProcessRecord -State $state -Record $record `
            -StopResult $result -StatePath $layout.StatePath
        $result
    }.GetNewClosure()
    $unloadAction = {
        param($currentState)
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
            if ([string]::IsNullOrWhiteSpace($ollamaPath)) {
                throw "The installed Ollama executable is unavailable."
            }
            $unload = Invoke-DemoVerifiedModelUnload -OllamaRecord $ollamaRecord `
                    -State $currentState -OllamaPath $ollamaPath `
                    -ModelName $constants.ModelName
            Register-FailedStopHelper -Role "ollama_cli" `
                -Result $unload.CommandResult
            if (-not $unload.Succeeded) {
                throw "The bounded Ollama model-unload command failed."
            }
            Write-Host "Unloaded launcher-resident qwen3:8b; the model remains installed."
            return [pscustomobject]@{
                Attempted = $true
                Succeeded = $true
                Reason = "unloaded"
            }
        } catch {
            Write-Warning "qwen3:8b could not be safely unloaded: $($_.Exception.Message)"
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
            "Ollama was preserved because an upstream launcher-owned process could " +
            "not be confirmed stopped."
        )
    }

    foreach ($entry in @($shutdown.ProcessResults)) {
        $record = $entry.Record
        $result = $entry.Result
        if ($result.Stopped) {
            Write-Host "Stopped launcher-owned $($record.role) process $($record.process_id)."
        } elseif ($result.Reason -eq "identity_mismatch_or_absent") {
            Write-Host (
                "Skipped stale $($record.role) PID $($record.process_id); its recorded " +
                "identity no longer matches."
            )
        } else {
            Write-Warning (
                "Did not stop $($record.role) PID $($record.process_id): $($result.Reason)"
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

    if ($remainingOwned.Count -gt 0) {
        throw (
            "One or more verified launcher-owned processes remain active. The state " +
            "file was preserved for a safe retry."
        )
    }
    Limit-DemoSessionLogs -LogDirectory $state.log_directory `
        -LogsRoot $layout.LogsRoot
    Remove-Item -LiteralPath $layout.StatePath -Force
    Remove-OldDemoLogSessions -LogsRoot $layout.LogsRoot

    $ports = Write-CurrentPortStatus
    if (-not $ports.FrontendFree -or -not $ports.BackendFree) {
        throw "Shutdown completed, but a required port is now occupied by an unrelated process."
    }

    $manifest = Get-DemoOllamaManifestPath -ModelName $constants.ModelName
    if (Test-Path -LiteralPath $manifest -PathType Leaf) {
        Write-Host "qwen3:8b remains installed."
    } else {
        Write-Warning "The qwen3:8b manifest is no longer present; the launcher did not remove it."
    }
    if ($LauncherProfile -eq "v3") {
        Write-Host "V3 Roadway Resilience demo is stopped."
    } else { Write-Host "Jason local chatbot demo is stopped." }
} finally {
    if ($null -ne $lifecycleLock) {
        $lifecycleLock.Dispose()
    }
}
