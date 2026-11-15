-- 054 — Modelo de prontuário "Avaliação por dinamometria" (dinamometria), 15/11/2026.
-- Preensão palmar + dinamometria isométrica segmentar; valores e escolhas em conteudo.dina (js/modulos/avaliacao-dinamometria.js).
-- area null no front = disponível para todas as áreas (nutrição: preensão/sarcopenia; fisioterapia: segmentar); a área gravada é a do conselho do autor.
alter table prontuario_registros drop constraint prontuario_registros_modelo_check;
alter table prontuario_registros add constraint prontuario_registros_modelo_check
  check (modelo = any (array['soapn','fisio_avaliacao','fisio_esportiva','fisio_evolucao','fisio_podo','fisio_postural','dinamometria','psico_registro','medica_consulta','livre']));
