#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$NoBrowser,
    [ValidateRange(80, 180)]
    [int]$WarmupTimeoutSeconds = 120,
    [ValidateRange(10, 60)]
    [int]$ServiceTimeoutSeconds = 30
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Keep private cleanup helpers in the entry scope used by GetNewClosure.
# One shared lifecycle; V2 defaults are never inferred or repointed.
. (Join-Path $PSScriptRoot "start-local-chatbot-demo.ps1") `
    -LauncherProfile v3 @PSBoundParameters
