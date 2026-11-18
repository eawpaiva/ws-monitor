<#
  WS Monitor - abre o app como janela de aplicativo (PWA), sem digitar URL.

  1. Garante que o servidor local (serve.ps1) está respondendo em http://localhost:<porta>/
  2. Abre o Microsoft Edge (ou Google Chrome) em modo app (--app=...), sem barra de endereço.

  Chamado pelo atalho "WS Monitor" criado por Instalar-Atalho.ps1.
#>
param([int]$Port = 8766)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:$Port/"

function Test-WsMonitorServer {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri ($url + 'manifest.webmanifest')
    # No PowerShell 5.1, .Content vem como byte[] para application/manifest+json: decodifica o corpo bruto
    $text = [System.Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())
    return ($text -match 'WS Monitor')
  } catch { return $false }
}

function Test-PortBusy {
  $c = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $c.BeginConnect('127.0.0.1', $Port, $null, $null)
    return ($iar.AsyncWaitHandle.WaitOne(300) -and $c.Connected)
  } catch { return $false } finally { $c.Close() }
}

Add-Type -AssemblyName PresentationFramework

if (-not (Test-WsMonitorServer)) {
  if (Test-PortBusy) {
    [System.Windows.MessageBox]::Show("A porta $Port já está em uso por outro programa. Feche-o ou edite o atalho com -Port <outra porta>.", 'WS Monitor', 'OK', 'Error') | Out-Null
    exit 1
  }
  $serve = Join-Path $PSScriptRoot 'serve.ps1'
  $psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$serve`" -Root `"$root`" -Port $Port"
  Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $psArgs -WindowStyle Hidden
  $ok = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 150
    if (Test-WsMonitorServer) { $ok = $true; break }
  }
  if (-not $ok) {
    [System.Windows.MessageBox]::Show("Não foi possível iniciar o servidor local do WS Monitor na porta $Port.", 'WS Monitor', 'OK', 'Error') | Out-Null
    exit 1
  }
}

$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $browser) {
  [System.Windows.MessageBox]::Show('Microsoft Edge ou Google Chrome não encontrado. O WS Monitor precisa de um deles (Web Serial).', 'WS Monitor', 'OK', 'Error') | Out-Null
  exit 1
}

Start-Process -FilePath $browser -ArgumentList "--app=$url"
