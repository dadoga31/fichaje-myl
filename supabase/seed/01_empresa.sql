-- =====================================================================
--  SEMILLA — Alta de la empresa
--
--  Se ejecuta UNA vez, en el editor SQL de Supabase, después de aplicar
--  las migraciones. Edite los valores antes de lanzarlo.
--
--  A partir de aquí, cada persona que se dé de alta en Auth obtiene su
--  perfil automáticamente (trigger handle_new_auth_user).
-- =====================================================================

insert into public.companies (name, cif, timezone, weekly_hours, retention_years)
values (
  'Mi Empresa SL',        -- ← razón social
  'B00000000',            -- ← CIF
  'Europe/Madrid',
  40,                     -- ← jornada semanal de referencia
  4                       -- conservación legal mínima: no bajar de 4
)
on conflict do nothing;

-- Identificador de la empresa: hace falta para dar de alta a las personas.
select id as company_id, name, cif from public.companies;
