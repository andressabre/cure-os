# Instalador do backup semanal do Cure OS para o OneDrive. Rodar UMA vez, no computador que fica com o OneDrive sincronizando.
# Pede: chave secreta do Supabase e a senha que vai proteger os backups. Guarda as duas cifradas pelo Windows (DPAPI).
$ErrorActionPreference = 'Stop'
$BASE = Join-Path $env:LOCALAPPDATA 'CureOS'
New-Item -ItemType Directory -Path $BASE -Force | Out-Null
Write-Host "`n=== Backup automático do Cure OS → OneDrive ===`n" -ForegroundColor Cyan

# 1. 7-Zip
$sz = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $sz) {
  Write-Host 'Instalando o 7-Zip (gratuito)...'
  winget install --id 7zip.7zip -e --accept-source-agreements --accept-package-agreements | Out-Null
  $sz = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $sz) { throw 'Não consegui instalar o 7-Zip. Instale por https://www.7-zip.org e rode este instalador de novo.' }
}
Write-Host '✓ 7-Zip encontrado'

# 2. Pasta do OneDrive
$od = @($env:OneDriveConsumer, $env:OneDrive, $env:OneDriveCommercial) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $od) { $od = Read-Host 'Não achei a pasta do OneDrive. Cole o caminho dela (ex.: C:\Users\voce\OneDrive)' }
$destino = Join-Path $od 'Backup Cure OS'
Write-Host "✓ Destino: $destino"

# 3. Segredos
Write-Host "`nChave secreta do Supabase: painel do Supabase → projeto cure-os → Project Settings → API Keys → 'Secret keys' → copie a chave (sb_secret_...)."
$chave = Read-Host 'Cole a chave secreta' -AsSecureString
do {
  $s1 = Read-Host "`nCrie a SENHA DO BACKUP (12+ caracteres). Sem ela os backups não abrem — anote fora deste computador" -AsSecureString
  $s2 = Read-Host 'Repita a senha' -AsSecureString
  $p1 = (New-Object PSCredential 'x', $s1).GetNetworkCredential().Password
  $p2 = (New-Object PSCredential 'x', $s2).GetNetworkCredential().Password
  if ($p1 -ne $p2) { Write-Host 'As senhas não conferem.' -ForegroundColor Yellow }
  elseif ($p1.Length -lt 12) { Write-Host 'Use 12 ou mais caracteres.' -ForegroundColor Yellow }
  elseif ($p1 -match '"') { Write-Host 'Não use aspas duplas (") na senha.' -ForegroundColor Yellow }
} until ($p1 -eq $p2 -and $p1.Length -ge 12 -and $p1 -notmatch '"')
[pscustomobject]@{
  Chave    = New-Object PSCredential 'supabase', $chave
  SenhaZip = New-Object PSCredential 'backup', $s1
  Destino  = $destino
} | Export-Clixml (Join-Path $BASE 'segredos.xml')
Write-Host '✓ Segredos guardados (cifrados pelo Windows, só este usuário lê)'

# 4. Script + tarefa semanal (domingo 20h; se o PC estiver desligado, roda assim que ligar)
Copy-Item (Join-Path $PSScriptRoot 'backup-cure-os.ps1') (Join-Path $BASE 'backup-cure-os.ps1') -Force
$acao = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$BASE\backup-cure-os.ps1`""
$quando = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 20:00
$cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 30)
$quem = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'Cure OS - Backup semanal OneDrive' -Action $acao -Trigger $quando -Settings $cfg -Principal $quem -Force | Out-Null
Write-Host '✓ Tarefa agendada: todo domingo às 20h'

# 5. Primeiro backup agora (testa tudo)
Write-Host "`nFazendo o primeiro backup agora..." -ForegroundColor Cyan
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $BASE 'backup-cure-os.ps1')
if ($LASTEXITCODE -eq 0) { Write-Host "`n✓ Pronto! Confira o arquivo em: $destino" -ForegroundColor Green }
else { Write-Host "`nO primeiro backup falhou. Veja o motivo em $BASE\backup.log" -ForegroundColor Red }
Read-Host "`nEnter para fechar"
