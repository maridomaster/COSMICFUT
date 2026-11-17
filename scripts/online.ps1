# COSMICFUT - modo online com link publico (Cloudflare Quick Tunnel)
# Sobe o servidor do jogo (porta 8787) se ainda nao estiver rodando,
# abre um tunel da Cloudflare e mostra/copia o link para mandar aos amigos.
# Feche esta janela para desligar o link.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$Host.UI.RawUI.WindowTitle = 'COSMICFUT ONLINE - link para os amigos (feche para desligar)'

function Test-Port8787 {
  [bool](Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue)
}

$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
  $guess = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
  if (Test-Path $guess) { $cf = $guess }
}
if (-not $cf) {
  Write-Host 'cloudflared nao encontrado. Instale com:  winget install Cloudflare.cloudflared' -ForegroundColor Red
  Read-Host 'Enter para sair'; exit 1
}

if (-not (Test-Port8787)) {
  # Recompila so se o codigo mudou desde o ultimo build
  $dist = 'apps\web\dist\index.html'
  $rebuild = $true
  if (Test-Path $dist) {
    $t = (Get-Item $dist).LastWriteTime
    $newer = Get-ChildItem apps\web\src, apps\web\public, packages\engine\src, packages\shared\src -Recurse -File |
      Where-Object { $_.LastWriteTime -gt $t } | Select-Object -First 1
    $rebuild = [bool]$newer
  }
  if ($rebuild) {
    Write-Host 'Atualizando o jogo, aguarde...' -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Host 'Erro ao compilar o jogo.' -ForegroundColor Red; Read-Host 'Enter para sair'; exit 1 }
  }
  Write-Host 'Iniciando o servidor do COSMICFUT...'
  Start-Process cmd -ArgumentList '/k', 'title COSMICFUT - servidor (feche para desligar o jogo) && npm run start --workspace @cosmicfut/server' -WindowStyle Minimized
  for ($i = 0; $i -lt 80 -and -not (Test-Port8787); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Port8787)) { Write-Host 'O servidor nao subiu na porta 8787.' -ForegroundColor Red; Read-Host 'Enter para sair'; exit 1 }
}

Write-Host 'Abrindo o tunel da Cloudflare...'
$log = Join-Path $env:TEMP 'cosmicfut-tunnel.log'
if (Test-Path $log) { Remove-Item $log -Force }
$proc = Start-Process $cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://localhost:8787', '--logfile', $log -PassThru -WindowStyle Hidden

$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Milliseconds 500
  if (Test-Path $log) {
    $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value }
  }
}
if (-not $url) {
  Write-Host 'Nao consegui obter o link da Cloudflare. Veja o log em' $log -ForegroundColor Red
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  Read-Host 'Enter para sair'; exit 1
}

$dataDir = Join-Path $root '.data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
$urlFile = Join-Path $dataDir 'public-url.txt'
Set-Content -Path $urlFile -Value $url -Encoding ascii -NoNewline

Set-Clipboard -Value $url
Write-Host ''
Write-Host '==============================================================' -ForegroundColor Green
Write-Host '  LINK DO JOGO (ja copiado, e so colar no WhatsApp/Discord):' -ForegroundColor Green
Write-Host "  $url" -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Green
Write-Host ''
Write-Host 'No jogo, clique em "Jogar online" e use o botao "Copiar link".'
Write-Host 'O link muda toda vez que voce abrir este atalho.'
Write-Host 'Deixe esta janela aberta enquanto estiverem jogando. Feche para desligar o link.'
# Abre o jogo pelo link publico: assim os convites copiados dentro da sala
# ja saem com o endereco da Cloudflare (e nao com localhost).
Start-Process $url

try { Wait-Process -Id $proc.Id }
finally {
  if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  if (Test-Path $urlFile) { Remove-Item $urlFile -Force }
}
