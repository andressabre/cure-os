-- 049 — Modelo de prontuário "Avaliação postural por foto (SAPO)" (fisio_postural), 15/11/2026.
-- Fotos no bucket privado "prontuario" (pasta <clinica>/<profissional>/…, leitura só do autor por pasta_prontuario_ok); pontos e medidas em conteudo.sapo.
alter table prontuario_registros drop constraint prontuario_registros_modelo_check;
alter table prontuario_registros add constraint prontuario_registros_modelo_check
  check (modelo = any (array['soapn','fisio_avaliacao','fisio_esportiva','fisio_evolucao','fisio_podo','fisio_postural','psico_registro','medica_consulta','livre']));
