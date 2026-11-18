<#
  WS Monitor - cria o atalho "WS Monitor" na área de trabalho e no menu Iniciar do usuário atual.
  Não exige administrador e não instala nada: o atalho chama launcher\WS-Monitor.ps1.
#>
param([int]$Port = 8766)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $PSScriptRoot 'WS-Monitor.ps1'
$icon = Join-Path $root 'assets\icons\ws-monitor.ico'
$ps = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"

$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'WS Monitor.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'WS Monitor.lnk')
)

$shell = New-Object -ComObject WScript.Shell
foreach ($lnk in $targets) {
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $ps
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -Port $Port"
  $s.WorkingDirectory = $root
  $s.IconLocation = "$icon,0"
  $s.WindowStyle = 7
  $s.Description = 'WS Monitor - Leitura da estação meteorológica WH24C'
  $s.Save()
  Write-Host "Atalho criado: $lnk"
}

Write-Host ''
Write-Host 'Pronto. Use o atalho "WS Monitor" na área de trabalho para abrir o app.'
