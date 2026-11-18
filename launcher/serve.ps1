<#
  WS Monitor - servidor HTTP local (somente localhost).

  Usa o HttpListener do .NET que já vem no Windows: nenhum software de terceiros.
  - Serve os arquivos estáticos do app em http://localhost:<porta>/
    (o Web Serial só funciona em https ou em localhost; por isso o app não abre direto do disco)
  - API local (só aceita chamadas do próprio app: cabeçalho X-WS-Monitor e origem localhost):
      POST /api/log?f=tecnico     acrescenta texto em log\AAAA-MM-DD_log-tecnico.txt
  - Encerra sozinho depois de um período sem requisições (o service worker do PWA continua
    servindo a interface do cache enquanto o servidor estiver parado).

  As gravações de medições (.csv/.txt) não passam por aqui: o navegador grava direto no arquivo
  escolhido pelo técnico.

  Uso: powershell -NoProfile -File serve.ps1 [-Root <pasta>] [-Port 8766] [-IdleMinutes 120]
#>
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [int]$Port = 8766,
  [int]$IdleMinutes = 120
)

$ErrorActionPreference = 'Stop'
$Root = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.ico'  = 'image/x-icon'
  '.woff2' = 'font/woff2'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}

# Pastas que não são servidas como arquivos estáticos
$blocked = @('.git', 'launcher', 'docs', 'log', 'tools', 'dist', 'config')

$utf8 = New-Object System.Text.UTF8Encoding($false)
$logDir = Join-Path $Root 'log'

function Read-Body($req) {
  $reader = New-Object System.IO.StreamReader($req.InputStream, $utf8)
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}
function Ensure-Dir($path) { if (-not [System.IO.Directory]::Exists($path)) { [void][System.IO.Directory]::CreateDirectory($path) } }

# Só o próprio app: cabeçalho X-WS-Monitor e, se houver, origem localhost (outros sites não conseguem chamar a API)
function Test-Caller($req) {
  if ($req.Headers['X-WS-Monitor'] -ne '1') { return $false }
  $origin = $req.Headers['Origin']
  if ($origin -and $origin -notmatch '^http://(localhost|127\.0\.0\.1)(:\d+)?$') { return $false }
  return $true
}

function Invoke-Api($req, $res) {
  $path = $req.Url.AbsolutePath
  $m = $req.HttpMethod
  if (-not (Test-Caller $req)) { $res.StatusCode = 403; return }

  if ($path -eq '/api/log' -and $m -eq 'POST') {
    if ($req.ContentLength64 -gt 4MB) { $res.StatusCode = 413; return }
    if ($req.QueryString['f'] -ne 'tecnico') { $res.StatusCode = 400; return }
    $name = (Get-Date -Format 'yyyy-MM-dd') + '_log-tecnico.txt'
    $text = Read-Body $req
    Ensure-Dir $logDir
    $file = Join-Path $logDir $name
    $text = $text -replace "(?<!`r)`n", "`r`n"
    [System.IO.File]::AppendAllText($file, $text, $utf8)
    $res.StatusCode = 204
    return
  }
  $res.StatusCode = 404
}

# ---------------------------------------------------------------- servidor
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

$idleLimit = [TimeSpan]::FromMinutes($IdleMinutes)
$lastHit = [DateTime]::UtcNow

try {
  while ($listener.IsListening) {
    $pending = $listener.BeginGetContext($null, $null)
    while (-not $pending.AsyncWaitHandle.WaitOne(5000)) {
      if (([DateTime]::UtcNow - $lastHit) -gt $idleLimit) { return }
    }
    $ctx = $listener.EndGetContext($pending)
    $lastHit = [DateTime]::UtcNow
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $res.Headers['Cache-Control'] = 'no-cache'
      $res.Headers['X-Content-Type-Options'] = 'nosniff'
      if ($req.Url.AbsolutePath.StartsWith('/api/')) {
        Invoke-Api $req $res
        continue
      }
      if ($req.HttpMethod -ne 'GET' -and $req.HttpMethod -ne 'HEAD') {
        $res.StatusCode = 405
        continue
      }
      $rel = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $first = ($rel -split '[\\/]')[0]
      $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))
      if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or
          ($blocked -contains $first) -or $first.StartsWith('.') -or
          -not [System.IO.File]::Exists($full)) {
        $res.StatusCode = 404
        continue
      }
      $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
      $type = $mime[$ext]
      if (-not $type) { $type = 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $res.ContentType = $type
      $res.ContentLength64 = $bytes.Length
      if ($req.HttpMethod -eq 'GET') { $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    } catch {
      try { $res.StatusCode = 500 } catch {}
    } finally {
      try { $res.Close() } catch {}
    }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
