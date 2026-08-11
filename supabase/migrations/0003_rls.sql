-- =====================================================================
--  FICHAJE MyL — Row Level Security
--
--  Principio de minimización (RGPD art. 5.1.c):
--    · La persona trabajadora ve ÚNICAMENTE sus propios fichajes.
--    · Admin/RRHH y manager ven los de su empresa, y nada de otras.
--    · El rol 'inspector' (Inspección de Trabajo / RLT) es SOLO LECTURA
--      y jamás puede escribir en el registro.
--    · Nadie, en ningún rol, puede hacer UPDATE ni DELETE sobre fichajes.
-- =====================================================================

alter table public.companies            enable row level security;
alter table public.profiles             enable row level security;
alter table public.time_entries         enable row level security;
alter table public.time_entry_audits    enable row level security;
alter table public.correction_requests  enable row level security;
alter table public.access_logs          enable row level security;

alter table public.time_entries        force row level security;
alter table public.time_entry_audits   force row level security;

-- ---------------------------------------------------------------------
-- Helpers. SECURITY DEFINER + STABLE para evitar recursión de políticas
-- al consultar profiles desde dentro de una política sobre profiles.
-- ---------------------------------------------------------------------
create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select company_id from public.profiles where id = auth.uid() $$;

create or replace function public.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(public.current_role() in ('admin', 'manager', 'inspector'), false) $$;

create or replace function public.can_write_registry()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select coalesce(public.current_role() in ('admin', 'manager', 'employee'), false) $$;

-- ---------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------
create policy companies_read on public.companies
  for select to authenticated
  using (id = public.current_company_id());

create policy companies_admin_update on public.companies
  for update to authenticated
  using (id = public.current_company_id() and public.current_role() = 'admin')
  with check (id = public.current_company_id() and public.current_role() = 'admin');

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create policy profiles_read_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_read_company on public.profiles
  for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());

-- Cada persona gestiona su propio consentimiento de geolocalización,
-- pero no su rol ni su empresa (blindado por trigger, ver más abajo).
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_admin_write on public.profiles
  for all to authenticated
  using (company_id = public.current_company_id() and public.current_role() = 'admin')
  with check (company_id = public.current_company_id() and public.current_role() = 'admin');

-- Impide la escalada de privilegios desde la política de auto-edición.
create or replace function public.protect_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() = new.id and coalesce(public.current_role(), 'employee') <> 'admin' then
    if new.role <> old.role or new.company_id <> old.company_id
       or new.contract_hours <> old.contract_hours or new.active <> old.active then
      raise exception 'No puede modificar su propio rol, empresa, jornada contratada ni estado de alta.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_protect_fields
  before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ---------------------------------------------------------------------
-- time_entries — lectura amplia, escritura estrecha, cero mutación
-- ---------------------------------------------------------------------
create policy time_entries_read_self on public.time_entries
  for select to authenticated
  using (user_id = auth.uid());

create policy time_entries_read_company on public.time_entries
  for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());

-- Fichaje propio: solo en tiempo real y sobre uno mismo.
create policy time_entries_insert_self on public.time_entries
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and company_id = public.current_company_id()
    and created_by = auth.uid()
    and origin in ('employee_app', 'employee_offline')
    and supersedes_id is null
    and public.current_role() <> 'inspector'
    -- Tolerancia de desfase: hasta 5 min de adelanto (reloj del móvil) y
    -- 24 h de retraso (sincronización de un fichaje hecho sin cobertura).
    and event_at <= now() + interval '5 minutes'
    and event_at >= now() - interval '24 hours'
  );

-- Alta manual y rectificación: exclusivas de administración, con motivo.
create policy time_entries_insert_admin on public.time_entries
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.current_role() in ('admin', 'manager')
    and created_by = auth.uid()
    and origin in ('admin_manual', 'correction')
    and reason is not null
  );

-- Ausencia deliberada de políticas UPDATE/DELETE: sin política, RLS lo
-- deniega todo. Los triggers de 0002 lo bloquean además para el propietario
-- de la tabla y para service_role.
revoke update, delete, truncate on public.time_entries      from authenticated, anon;
revoke update, delete, truncate on public.time_entry_audits from authenticated, anon;
revoke insert, update, delete, truncate on public.time_entry_audits from authenticated, anon;

-- ---------------------------------------------------------------------
-- time_entry_audits — legible por la persona afectada y por la empresa
-- ---------------------------------------------------------------------
create policy audits_read_self on public.time_entry_audits
  for select to authenticated
  using (
    exists (
      select 1 from public.time_entries e
      where e.id = time_entry_audits.entry_id and e.user_id = auth.uid()
    )
  );

create policy audits_read_company on public.time_entry_audits
  for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());

-- ---------------------------------------------------------------------
-- correction_requests
-- ---------------------------------------------------------------------
create policy corrections_read_self on public.correction_requests
  for select to authenticated
  using (user_id = auth.uid());

create policy corrections_read_company on public.correction_requests
  for select to authenticated
  using (company_id = public.current_company_id() and public.is_staff());

create policy corrections_insert_self on public.correction_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and company_id = public.current_company_id()
    and status = 'pending'
    and public.current_role() <> 'inspector'
  );

-- La persona solicitante solo puede retirar su solicitud mientras esté pendiente.
create policy corrections_cancel_self on public.correction_requests
  for update to authenticated
  using (user_id = auth.uid() and status = 'pending')
  with check (user_id = auth.uid() and status = 'cancelled');

create policy corrections_review on public.correction_requests
  for update to authenticated
  using (company_id = public.current_company_id() and public.current_role() in ('admin', 'manager'))
  with check (company_id = public.current_company_id() and reviewed_by = auth.uid());

-- ---------------------------------------------------------------------
-- access_logs — se escribe siempre, se lee solo por administración
-- ---------------------------------------------------------------------
create policy access_logs_insert on public.access_logs
  for insert to authenticated
  with check (actor_id = auth.uid() and company_id = public.current_company_id());

create policy access_logs_read on public.access_logs
  for select to authenticated
  using (company_id = public.current_company_id() and public.current_role() = 'admin');
