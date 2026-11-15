-- 055 — Modelo "Projeto de palmilha 3D" (fisio_palmilha3d), aba Avaliações, 15/11/2026.
-- Escaneamento .obj compactado (.obj.gz) no bucket privado "prontuario" (pasta do autor); parâmetros, ajustes e resultado em conteudo.palmilha.
-- Processamento 100% no navegador (js/modulos/palmilha3d-motor.js). Protocolos da clínica em clinicas.config.palmilha_protocolos.
alter table prontuario_registros drop constraint prontuario_registros_modelo_check;
alter table prontuario_registros add constraint prontuario_registros_modelo_check
  check (modelo = any (array['soapn','fisio_avaliacao','fisio_esportiva','fisio_evolucao','fisio_podo','fisio_postural','fisio_palmilha3d','dinamometria','psico_registro','medica_consulta','livre']));
