-- CURE OS — Migração 021: aviso no fechamento quando a autorização não tem encaminhamento (anexo 03 obrigatório)
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('guia_atendimento(uuid,uuid,uuid,jsonb,boolean,jsonb)'::regprocedure);
  n := replace(d, '  r := r || jsonb_build_object(''bloqueios'', v_bloq, ''avisos'', v_avis, ''autorizacao_id'', v_aut,',
    '  if v_exige and au.id is not null and au.encaminhamento_id is null then
    v_avis := v_avis || to_jsonb(''Autorização sem encaminhamento vinculado: o pedido médico é anexo obrigatório no faturamento (ficha do paciente → Autorizações).''::text);
  end if;
  r := r || jsonb_build_object(''bloqueios'', v_bloq, ''avisos'', v_avis, ''autorizacao_id'', v_aut,');
  if n = d then raise exception 'Trecho esperado não encontrado na guia_atendimento'; end if;
  execute n;
end $$;
