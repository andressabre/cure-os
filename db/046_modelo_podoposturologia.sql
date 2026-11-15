-- 046 — Modelo de prontuário "Avaliação podoposturológica" (baropodometria/palmilha), separado da avaliação de fisioterapia.
alter table prontuario_registros drop constraint prontuario_registros_modelo_check;
alter table prontuario_registros add constraint prontuario_registros_modelo_check
  check (modelo = any (array['soapn','fisio_avaliacao','fisio_esportiva','fisio_evolucao','fisio_podo','psico_registro','medica_consulta','livre']));
