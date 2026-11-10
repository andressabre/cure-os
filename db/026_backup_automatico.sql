-- 026 — Backup semanal automático (ferramentas/backup-onedrive): o script do computador avisa o Cure OS ao terminar.
-- Só a chave secreta (service_role) executa; grava a data no cartão "Backup" do Painel.
create or replace function registrar_backup_automatico(p_arquivo text, p_linhas int, p_arquivos int)
returns void language sql security definer set search_path = public as $$
  update clinicas set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'ultimo_backup', now(), 'ultimo_backup_tipo', 'automatico',
    'ultimo_backup_info', jsonb_build_object('arquivo', p_arquivo, 'linhas', p_linhas, 'arquivos', p_arquivos));
$$;
revoke execute on function registrar_backup_automatico(text, int, int) from public, anon, authenticated;
grant execute on function registrar_backup_automatico(text, int, int) to service_role;
