-- 044 — Avaliação por cliques (item 15): novos modelos de prontuário e área "medicina".
-- Só amplia as listas permitidas; nenhum dado existente muda. As escolhas dos chips ficam em conteudo->'cliques' (jsonb já existente).
alter table prontuario_registros drop constraint prontuario_registros_modelo_check;
alter table prontuario_registros add constraint prontuario_registros_modelo_check
  check (modelo = any (array['soapn','fisio_avaliacao','fisio_esportiva','fisio_evolucao','psico_registro','medica_consulta','livre']));
alter table prontuario_registros drop constraint prontuario_registros_area_check;
alter table prontuario_registros add constraint prontuario_registros_area_check
  check (area = any (array['nutricao','fisioterapia','psicologia','medicina','outra']));
