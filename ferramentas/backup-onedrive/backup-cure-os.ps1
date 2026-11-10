# Backup automático do Cure OS para a pasta do OneDrive (o cliente do OneDrive sobe o arquivo para a nuvem).
# Roda pelo Agendador de Tarefas (instalado por instalar.ps1). NÃO contém senhas: elas ficam no Windows (DPAPI),
# em %LOCALAPPDATA%\CureOS\segredos.xml, legíveis só por este usuário neste computador.
#
# O que salva: todas as tabelas (JSON, inclui os prontuários de TODOS os profissionais) + todos os arquivos do Storage.
# Saída: OneDrive\Backup Cure OS\cure-os-AAAA-MM-DD.7z (AES-256, nomes dos arquivos também cifrados). Mantém os últimos 12.

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# O PowerShell se identifica como "Mozilla/..." e o Supabase recusa chave secreta vinda de navegador (401).
$UA = 'CureOS-Backup/1.1 (PowerShell)'
$PSDefaultParameterValues['Invoke-RestMethod:UserAgent'] = $UA
$PSDefaultParameterValues['Invoke-WebRequest:UserAgent'] = $UA
$etapa = 'início'

$URL      = 'https://paipxhfhwiztznvbxawz.supabase.co'
$BASE     = Join-Path $env:LOCALAPPDATA 'CureOS'
$LOG      = Join-Path $BASE 'backup.log'
$MANTER   = 12
$SEVENZIP = @("$env:ProgramFiles\7-Zip\7z.exe", "${env:ProgramFiles(x86)}\7-Zip\7z.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1

function Log($m) { $l = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"; Add-Content -Path $LOG -Value $l -Encoding UTF8; Write-Host $l }

try {
  if (-not $SEVENZIP) { throw '7-Zip não encontrado. Rode o instalar.ps1 de novo.' }
  $seg = Import-Clixml (Join-Path $BASE 'segredos.xml')
  $chave = $seg.Chave.GetNetworkCredential().Password
  $senhaZip = $seg.SenhaZip.GetNetworkCredential().Password
  $destino = $seg.Destino
  if (-not (Test-Path $destino)) { New-Item -ItemType Directory -Path $destino | Out-Null }

  # Chave nova (sb_secret_...) vai só no apikey; chave antiga (JWT) vai também no Authorization.
  $H = @{ apikey = $chave }
  if ($chave -like 'eyJ*') { $H.Authorization = "Bearer $chave" }

  $hoje = Get-Date -Format 'yyyy-MM-dd'
  $tmp = Join-Path $env:TEMP "cure-os-backup-$hoje-$(Get-Random)"
  New-Item -ItemType Directory -Path (Join-Path $tmp 'dados'), (Join-Path $tmp 'arquivos') -Force | Out-Null
  Log "Início do backup ($hoje)"

  # ---------- Tabelas: lista vem da própria API (novas tabelas entram sozinhas)
  $etapa = 'teste da chave'
  if ($chave -notmatch '^(sb_secret_|eyJ)') { throw 'A chave salva não parece uma chave secreta (deve começar com sb_secret_). Rode o INSTALAR.cmd de novo.' }
  Invoke-WebRequest -Uri "$URL/rest/v1/clinicas?select=id&limit=1" -Headers $H -UseBasicParsing | Out-Null
  $etapa = 'lista de tabelas'
  $api = $null
  try { $api = Invoke-RestMethod -Uri "$URL/rest/v1/" -Headers $H -UseBasicParsing } catch { Log 'Aviso: a API não devolveu a lista de tabelas; usando a lista fixa.' }
  $tabelas = @(if ($api) { $api.definitions.PSObject.Properties.Name | Where-Object { $_ -notmatch '^rpc' } | Sort-Object })
  if (-not $tabelas.Count) {  # reserva, caso a API não liste as tabelas
    $tabelas = @('clinicas','cnpjs_faturamento','profissionais','usuarios_clinica','convites','pacientes','operadoras','contratos','paciente_planos',
      'procedimentos','contrato_tabela','regras_repasse','solicitantes','encaminhamentos','autorizacoes','atendimentos','lotes','guias','guia_itens',
      'guia_anexos','motivos_glosa','glosas_operadora','retornos','retorno_linhas','glosas','notificacoes','auditoria','contas_financeiras',
      'categorias_financeiras','lancamentos','prontuario_registros','prontuario_adendos','prontuario_anexos','prontuario_versoes',
      'documento_modelos','documentos_emitidos')
  }
  $totalLinhas = 0
  foreach ($t in $tabelas) {
    $pag = 1000; $off = 0; $n = 0; $parte = 0
    $etapa = "tabela $t"
    $temId = if ($api -and $api.definitions.$t) { $api.definitions.$t.properties.PSObject.Properties.Name -contains 'id' } else { $t -notin @('motivos_glosa','glosas_operadora') }
    do {
      $parte++
      $q = "$URL/rest/v1/$t`?select=*&limit=$pag&offset=$off" + $(if ($temId) { '&order=id' } else { '' })
      $arq = Join-Path $tmp ("dados\{0}.{1:D3}.json" -f $t, $parte)
      Invoke-WebRequest -Uri $q -Headers $H -UseBasicParsing -OutFile $arq
      $j = Get-Content $arq -Raw -Encoding UTF8 | ConvertFrom-Json
      $qtd = if ($null -eq $j) { 0 } else { ($j | ForEach-Object { $_ } | Measure-Object).Count }  # PS 5.1 não desenrola o array
      if ($qtd -eq 0 -and $parte -gt 1) { Remove-Item $arq }
      $n += $qtd; $off += $pag
    } while ($qtd -eq $pag)
    $totalLinhas += $n
  }
  Log "Tabelas: $($tabelas.Count) · linhas: $totalLinhas"

  # ---------- Storage: todos os buckets, recursivo
  $etapa = 'arquivos do Storage'
  $buckets = Invoke-RestMethod -Uri "$URL/storage/v1/bucket" -Headers $H -UseBasicParsing
  $totalArq = 0
  function Listar($bucket, $prefixo) {
    $off = 0
    do {
      $corpo = @{ prefix = $prefixo; limit = 1000; offset = $off; sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json -Compress
      $itens = @(Invoke-RestMethod -Method Post -Uri "$URL/storage/v1/object/list/$bucket" -Headers $H -ContentType 'application/json; charset=utf-8' `
        -Body ([Text.Encoding]::UTF8.GetBytes($corpo)) -UseBasicParsing | ForEach-Object { $_ })
      foreach ($i in $itens) {
        $caminho = if ($prefixo) { "$prefixo/$($i.name)" } else { $i.name }
        if ($null -eq $i.id) { Listar $bucket $caminho } else { $caminho }
      }
      $off += 1000
    } while ($itens.Count -eq 1000)
  }
  foreach ($b in $buckets) {
    foreach ($c in @(Listar $b.id '')) {
      $local = Join-Path $tmp ("arquivos\$($b.id)\" + ($c -replace '/', '\'))
      New-Item -ItemType Directory -Path (Split-Path $local) -Force | Out-Null
      $enc = ($c -split '/' | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
      Invoke-WebRequest -Uri "$URL/storage/v1/object/authenticated/$($b.id)/$enc" -Headers $H -UseBasicParsing -OutFile $local
      $totalArq++
    }
  }
  Log "Arquivos do Storage: $totalArq"

  @"
Backup do Cure OS — gerado em $(Get-Date -Format 'dd/MM/yyyy HH:mm') (automático, semanal)

dados\    todas as tabelas em JSON, em partes de 1000 linhas (tabela.001.json, tabela.002.json…).
          Inclui o prontuário de TODOS os profissionais (guarda institucional).
arquivos\ todos os arquivos do Storage, por bucket (documentos, prontuario…), no mesmo caminho do sistema.

Tabelas: $($tabelas.Count) · linhas: $totalLinhas · arquivos: $totalArq
Contém dados de saúde (LGPD). Não compartilhe o link deste arquivo do OneDrive.
Para abrir: 7-Zip → Extrair → senha do backup (a mesma definida na instalação).
"@ | Set-Content -Path (Join-Path $tmp 'LEIA-ME.txt') -Encoding UTF8

  $etapa = 'compactação'
  # ---------- Compacta com senha (AES-256, cabeçalho cifrado) direto na pasta do OneDrive
  $final = Join-Path $destino "cure-os-$hoje.7z"
  $parcial = "$final.parcial"
  if (Test-Path $parcial) { Remove-Item $parcial -Force }
  & $SEVENZIP a -t7z -mx=7 -mhe=on "-p$senhaZip" $parcial (Join-Path $tmp '*') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "7-Zip terminou com erro $LASTEXITCODE" }
  & $SEVENZIP t "-p$senhaZip" $parcial | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Teste do arquivo compactado falhou' }
  Move-Item $parcial $final -Force
  Remove-Item $tmp -Recurse -Force
  Log ("Arquivo: $final ({0:N1} MB)" -f ((Get-Item $final).Length / 1MB))

  # ---------- Mantém só os últimos $MANTER
  Get-ChildItem $destino -Filter 'cure-os-*.7z' | Sort-Object Name -Descending | Select-Object -Skip $MANTER | ForEach-Object {
    Remove-Item $_.FullName -Force; Log "Removido backup antigo: $($_.Name)" }

  $etapa = 'aviso ao Painel'
  # ---------- Avisa o Cure OS (cartão "Backup" do Painel fica verde)
  Invoke-RestMethod -Method Post -Uri "$URL/rest/v1/rpc/registrar_backup_automatico" -Headers $H -ContentType 'application/json' `
    -Body (@{ p_arquivo = "cure-os-$hoje.7z"; p_linhas = $totalLinhas; p_arquivos = $totalArq } | ConvertTo-Json -Compress) -UseBasicParsing | Out-Null
  Log 'Concluído com sucesso.'
  exit 0
}
catch {
  $msg = $_.Exception.Message
  if ($msg -match '401') { $msg += ' — chave recusada. Confira se copiou a SECRET key (sb_secret_...) do projeto cure-os, inteira, e rode o INSTALAR.cmd de novo.' }
  Log "ERRO na etapa '$etapa': $msg"
  if ($tmp -and (Test-Path $tmp)) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  exit 1
}
