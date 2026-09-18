#requires -Version 5.1
[CmdletBinding()]
param([switch]$NoBrowser,
    [ValidateRange(80,180)][int]$WarmupTimeoutSeconds = 180,
    [ValidateRange(10,60)][int]$ServiceTimeoutSeconds = 30)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Write-Host 'EXPERIMENTAL Gemma integration; partial GPU offload may be slower.'
. (Join-Path $PSScriptRoot 'start-local-chatbot-demo.ps1') -LauncherProfile v3-dev @PSBoundParameters
