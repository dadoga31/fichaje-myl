-- =====================================================================
--  FICHAJE MyL — Sincronización en tiempo real y alta de personas
--
--  Dos cosas que solo hacen falta cuando la aplicación deja de ser una
--  demostración y pasa a usarse de verdad:
--    1) Que un fichaje aparezca AL INSTANTE en el panel de quien
--       supervisa, sin recargar ni esperar a un sondeo.
--    2) Que dar de alta a una persona real cree su perfil automáticamente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) REPLICACIÓN EN TIEMPO REAL
--
-- Supabase Realtime publica los cambios de las tablas incluidas en la
-- publicación `supabase_realtime`, y aplica la RLS de cada suscriptor: la
-- persona trabajadora solo recibe sus propios fichajes; administración,
-- los de su empresa. La difusión NO abre ningún agujero de privacidad.
-- ---------------------------------------------------------------------

-- REPLICA IDENTITY FULL hace que el evento lleve la fila completa, que es
-- lo que necesita Realtime para poder evaluar las políticas de RLS.
alter table public.time_entries        replica identity full;
alter table public.correction_requests replica identity full;
alter table public.profiles            replica identity full;

-- La publicación solo existe en Supabase. En un PostgreSQL limpio (CI,
-- desarrollo local) esta migración debe aplicar igualmente sin ruido.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- `add table` falla si la tabla ya está publicada: se comprueba antes.
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'time_entries'
    ) then
      alter publication supabase_realtime add table public.time_entries;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'correction_requests'
    ) then
      alter publication supabase_realtime add table public.correction_requests;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
      alter publication supabase_realtime add table public.profiles;
    end if;

    raise notice 'Realtime activado para time_entries, correction_requests y profiles.';
  else
    raise notice 'Sin publicación supabase_realtime (PostgreSQL sin Supabase): paso omitido.';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 2) ALTA DE PERSONAS REALES
--
-- Al crear el usuario en Supabase Auth (panel, API o script), este trigger
-- crea su perfil con los datos que vengan en los metadatos. Así no hay que
-- tocar dos sitios ni queda un usuario sin perfil, que no podría ni entrar.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company   uuid;
  v_role      public.user_role;
  v_full_name text;
  v_meta      jsonb;
begin
  v_meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);

  -- Si ya existe el perfil (alta manual previa), no se toca nada.
  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  v_company := nullif(v_meta ->> 'company_id', '')::uuid;

  -- Con una sola empresa dada de alta, se asume esa: es el caso normal.
  if v_company is null then
    if (select count(*) from public.companies) = 1 then
      select id into v_company from public.companies;
    else
      raise exception
        'Indique company_id en los metadatos del usuario: hay % empresas dadas de alta.',
        (select count(*) from public.companies);
    end if;
  end if;

  v_role := coalesce(nullif(v_meta ->> 'role', ''), 'employee')::public.user_role;

  -- Sin nombre explícito se usa la parte local del correo, nunca vacío.
  v_full_name := coalesce(
    nullif(btrim(v_meta ->> 'full_name'), ''),
    initcap(replace(split_part(new.email, '@', 1), '.', ' '))
  );

  insert into public.profiles (
    id, company_id, full_name, email, role,
    employee_number, nif, contract_hours, hired_on
  ) values (
    new.id,
    v_company,
    v_full_name,
    new.email,
    v_role,
    nullif(btrim(v_meta ->> 'employee_number'), ''),
    nullif(btrim(v_meta ->> 'nif'), ''),
    coalesce(nullif(v_meta ->> 'contract_hours', '')::numeric, 40),
    coalesce(nullif(v_meta ->> 'hired_on', '')::date, current_date)
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

comment on function public.handle_new_auth_user() is
  'Crea el perfil al dar de alta un usuario en Auth, con los datos de raw_user_meta_data '
  '(company_id, role, full_name, employee_number, nif, contract_hours).';
