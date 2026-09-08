#requires -Version 5.1
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Import-Module (Join-Path $PSScriptRoot "lib\LocalDemo.Core.psm1") -Force -ArgumentList v3
Import-Module (Join-Path $PSScriptRoot "lib\LocalDemo.Windows.psm1") -Force -ArgumentList v3
Write-V3DemoStatus -Layout (Get-LocalDemoLayout -ScriptRoot $PSScriptRoot)
