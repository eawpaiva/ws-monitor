<#
  WS Monitor - gera o pacote de distribuição para o laboratório.

  Cria dist\ws-monitor-v<versão>.zip com uma pasta "ws-monitor\" contendo só o necessário para rodar o app,
  mais o README.txt do laboratório (gerado de tools\README-tecnico.txt, com a versão preenchida),
  e dist\README.txt ao lado do zip.
  Ficam de fora: .git, docs, tests, tools, dist e os dados locais (log\).

  Uso (na raiz do projeto ou de qualquer lugar):
    powershell -NoProfile -ExecutionPolicy Bypass -File tools\empacotar.ps1
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Versão: a mesma do app (js/config.js -> APP_VERSION)
$config = [System.IO.File]::ReadAllText((Join-Path $root 'js\config.js'))
if ($config -notmatch "APP_VERSION\s*=\s*'([^']+)'") { throw 'APP_VERSION não encontrada em js\config.js' }
$version = $Matches[1]

# O que entra no pacote
$include = @('index.html', 'manifest.webmanifest', 'sw.js', 'Instalar.cmd', 'css', 'js', 'assets', 'launcher')
$required = @('launcher\serve.ps1', 'launcher\WS-Monitor.ps1', 'launcher\Instalar-Atalho.ps1', 'assets\icons\ws-monitor.ico', 'assets\fonts\Montserrat-latin.woff2')
foreach ($r in $required) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $r))) { throw "Arquivo obrigatório ausente: $r" }
}

$files = New-Object System.Collections.Generic.List[string]
foreach ($item in $include) {
  $full = Join-Path $root $item
  if (-not (Test-Path -LiteralPath $full)) { throw "Item do pacote não encontrado: $item" }
  if ((Get-Item -LiteralPath $full).PSIsContainer) {
    Get-ChildItem -LiteralPath $full -Recurse -File | ForEach-Object { $files.Add($_.FullName) }
  } else {
    $files.Add((Resolve-Path -LiteralPath $full).Path)
  }
}

# README do laboratório, com a versão preenchida e quebras de linha do Windows
$readmeSrc = Join-Path $PSScriptRoot 'README-tecnico.txt'
$readme = [System.IO.File]::ReadAllText($readmeSrc).Replace('{VERSAO}', $version) -replace "(?<!`r)`n", "`r`n"
$bom = New-Object System.Text.UTF8Encoding($true)

$dist = Join-Path $root 'dist'
if (-not (Test-Path $dist)) { [void](New-Item -ItemType Directory -Path $dist) }
$zipPath = Join-Path $dist "ws-monitor-v$version.zip"
if (Test-Path $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($f in $files) {
    $rel = $f.Substring($rootFull.Length).Replace('\', '/')
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f, "ws-monitor/$rel", [System.IO.Compression.CompressionLevel]::Optimal)
  }
  $entry = $zip.CreateEntry('ws-monitor/README.txt', [System.IO.Compression.CompressionLevel]::Optimal)
  $w = New-Object System.IO.StreamWriter($entry.Open(), $bom)
  try { $w.Write($readme) } finally { $w.Dispose() }
} finally {
  $zip.Dispose()
}
[System.IO.File]::WriteAllText((Join-Path $dist 'README.txt'), $readme, $bom)

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $zipPath).Length
Write-Host ''
Write-Host "Pacote gerado: $zipPath"
Write-Host ("Versão {0} · {1} arquivos · {2:N0} KB" -f $version, ($files.Count + 1), ($size / 1KB))
Write-Host "SHA-256: $hash"
Write-Host "Instruções para o laboratório: $(Join-Path $dist 'README.txt')"
Write-Host ''
Write-Host 'No computador do laboratório: Propriedades do zip > Desbloquear, extrair em C:\ (cria C:\ws-monitor) e executar Instalar.cmd.'
