-- 028 — Recepção e financeiro também apagam arquivos do bucket "documentos" (trocar/remover/excluir anexo de encaminhamento).
alter policy documentos_apagar on storage.objects
  using (bucket_id = 'documentos' and pasta_clinica_ok(name, array['gestor', 'recepcao', 'financeiro']));
