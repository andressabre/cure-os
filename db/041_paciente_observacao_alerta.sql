-- 041: observação livre e alerta interno no cadastro do paciente.
-- O alerta aparece em destaque na ficha e ao escolher o paciente na agenda (ex.: não reagendar, conduta combinada com a gestão).
-- Escrever só fatos objetivos (LGPD: o paciente pode pedir acesso ao próprio cadastro).
alter table public.pacientes add column if not exists observacao text;
alter table public.pacientes add column if not exists alerta text;
