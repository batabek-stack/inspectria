$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
if (-not $root) {
  $root = (Get-Location).Path
}

$launcher = Join-Path $root "start_mod_checklist_server_forever.bat"

if (-not (Test-Path $launcher)) {
  throw "Launcher file not found: $launcher"
}

$taskName = "MOD-Check-List-Server-TEST"
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -User "SYSTEM" `
  -RunLevel Highest `
  -Force

Write-Host "Scheduled task '$taskName' created."
Write-Host "The TEST server will start automatically when Windows boots."
