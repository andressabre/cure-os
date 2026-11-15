-- 047 — Tipo de documento "solicitacao" (solicitação de exame: escanometria, RX dos pés, RX panorâmico de coluna).
alter table documentos_emitidos drop constraint documentos_emitidos_tipo_check;
alter table documentos_emitidos add constraint documentos_emitidos_tipo_check
  check (tipo = any (array['atestado','comparecimento','acompanhante','alta','relatorio','orientacoes','solicitacao','livre']));
