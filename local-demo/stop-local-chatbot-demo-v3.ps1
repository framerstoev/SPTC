#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateRange(1, 10)]
    [int]$GraceSeconds = 3
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "stop-local-chatbot-demo.ps1") `
    -LauncherProfile v3 @PSBoundParameters
