#requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Import-Module (Join-Path $PSScriptRoot "lib\LocalDemo.Core.psm1") -Force
Import-Module (Join-Path $PSScriptRoot "lib\LocalDemo.Windows.psm1") -Force

$constants = Get-LocalDemoConstants
$layout = Get-LocalDemoLayout -ScriptRoot $PSScriptRoot
Assert-DemoRuntimePathSafety -Layout $layout
$state = Read-DemoState -StatePath $layout.StatePath -Layout $layout

Write-Host "Jason local chatbot demo status"
Write-Host "Browser: $($constants.BrowserUrl)"

if ($null -eq $state) {
    Write-Host "Launcher state: no active session recorded"
} else {
    Write-Host "Launcher state: $($state.status)"
    Write-Host "Session: $($state.session_id)"
    Write-Host "Logs: $($state.log_directory)"
    foreach ($record in @($state.processes)) {
        $actual = Get-DemoProcessFact -ProcessId ([int]$record.process_id)
        $identity = Test-DemoProcessIdentity -Record $record -ActualProcess $actual
        if ($identity -and $record.role -in @("ollama", "backend", "frontend") -and
            $null -ne $record.launcher_process_id) {
            try {
                Assert-DemoChildServiceLink -Record $record -State $state
            } catch {
                $identity = $false
            }
        }
        $ownership = if ($record.created_by_launcher -eq $true) {
            "launcher-owned"
        } else {
            "pre-existing"
        }
        Write-Host (
            "Process {0}: PID {1}, {2}, identity {3}" -f
            $record.role, $record.process_id, $ownership,
            $(if ($identity) { "valid" } else { "not running/stale" })
        )
    }
}

$frontendListeners = @(Get-DemoPortListeners -Port 8001)
if ($frontendListeners.Count -eq 0) {
    Write-Host "Frontend: stopped (port 8001 free)"
} else {
    try {
        $frontendStatus = Wait-DemoHttpStatus -Url $constants.BrowserUrl -TimeoutSeconds 3
        Write-Host "Frontend: HTTP $frontendStatus on 127.0.0.1:8001"
    } catch {
        Write-Host "Frontend: listener present, page unavailable"
    }
}

$backendListeners = @(Get-DemoPortListeners -Port 8080)
if ($backendListeners.Count -eq 0) {
    Write-Host "FastAPI: stopped (port 8080 free)"
} else {
    try {
        $health = Wait-DemoHttpJson -Url "$($constants.BackendUrl)/health" -TimeoutSeconds 3
        Assert-DemoBackendHealth -Health $health
        Write-Host "FastAPI: healthy at $($constants.BackendUrl)"
    } catch {
        Write-Host "FastAPI: listener present, accepted health contract unavailable"
    }
}

$ollamaListeners = @(Get-DemoPortListeners -Port 11434)
if ($ollamaListeners.Count -eq 0) {
    Write-Host "Ollama: stopped (port 11434 free)"
} else {
    try {
        $ollamaCandidates = @()
        if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
            $ollamaCandidates += Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
        }
        $ollamaPath = Resolve-DemoExecutable -CommandName "ollama.exe" `
            -Candidates $ollamaCandidates
        [void](Resolve-DemoPortPolicy -Port 11434 -Listeners $ollamaListeners `
                -ExpectedOllamaPath $ollamaPath)
        $version = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/version" `
            -TimeoutSeconds 3
        if ($version.HttpStatus -ne 200 -or
            [string]::IsNullOrWhiteSpace([string]$version.Body.version)) {
            throw "Ollama version contract unavailable"
        }
        $tags = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/tags" `
            -TimeoutSeconds 3
        if ($tags.HttpStatus -ne 200 -or
            -not (Test-DemoModelInstalledFromApi -TagsBody $tags.Body `
                -ModelName $constants.ModelName)) {
            throw "Installed qwen3:8b contract unavailable"
        }
        $resident = Wait-DemoHttpJson -Url "$($constants.OllamaUrl)/api/ps" `
            -TimeoutSeconds 3
        try {
            $allocation = Get-DemoOllamaAllocationFromApi -Body $resident.Body `
                -ModelName $constants.ModelName
            Write-Host (
                "Ollama: version {0}, loopback-only, {1} resident ({2}, {3} MiB VRAM)" -f
                $version.Body.version, $constants.ModelName,
                $allocation.Allocation, $allocation.VramMiB
            )
        } catch {
            Write-Host (
                "Ollama: version {0}, loopback-only, {1} not resident or not 100% GPU" -f
                $version.Body.version, $constants.ModelName
            )
        }
    } catch {
        Write-Warning "Ollama listener is present but could not be verified safely."
    }
}
