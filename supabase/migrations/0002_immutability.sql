-- =====================================================================
--  FICHAJE MyL — Inalterabilidad, sellado de integridad y auditoría
--
--  Esta migración es el corazón del cumplimiento del Art. 34.9 ET.
--  Tres barreras independientes protegen el registro:
--    1) Permisos: UPDATE/DELETE revocados a nivel de rol.
--    2) Triggers: bloqueo incondicional, incluso para el propietario.
--    3) Cadena hash: cualquier manipulación por fuera de la aplicación
--       (p. ej. acceso directo al SQL) rompe la cadena y es detectable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) BLOQUEO DE MODIFICACIÓN Y BORRADO
-- ---------------------------------------------------------------------
create or replace function public.deny_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'REGISTRO INALTERABLE: la tabla % no admite % (Art. 34.9 ET). '
    'Para rectificar un fichaje inserte un asiento nuevo con supersedes_id y motivo.',
    tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

create trigger time_entries_no_update
  before update on public.time_entries
  for each row execute function public.deny_mutation();

create trigger time_entries_no_delete
  before delete on public.time_entries
  for each row execute function public.deny_mutation();

create trigger time_entry_audits_no_update
  before update on public.time_entry_audits
  for each row execute function public.deny_mutation();

create trigger time_entry_audits_no_delete
  before delete on public.time_entry_audits
  for each row execute function public.deny_mutation();

create trigger access_logs_no_mutation
  before update or delete on public.access_logs
  for each row execute function public.deny_mutation();

-- TRUNCATE también quedaría fuera de los triggers FOR EACH ROW: lo cerramos aparte.
create trigger time_entries_no_truncate
  before truncate on public.time_entries
  for each statement execute function public.deny_mutation();

create trigger time_entry_audits_no_truncate
  before truncate on public.time_entry_audits
  for each statement execute function public.deny_mutation();

-- ---------------------------------------------------------------------
-- 2) SELLADO: cadena hash por empresa + normalización de campos servidor
-- ---------------------------------------------------------------------
create or replace function public.seal_time_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev_hash text;
  v_tz        text;
  v_payload   text;
begin
  -- El servidor sella la hora de grabación: el cliente no puede falsearla.
  new.recorded_at := now();
  new.created_at  := now();

  select timezone into v_tz from public.companies where id = new.company_id;
  v_tz := coalesce(v_tz, 'Europe/Madrid');

  -- La fecha de imputación se deriva del huso de la empresa, no del navegador.
  new.work_date := (new.event_at at time zone v_tz)::date;

  -- Último eslabón de la cadena de esta empresa (bloqueado para evitar
  -- entrelazado bajo concurrencia).
  select entry_hash into v_prev_hash
    from public.time_entries
   where company_id = new.company_id
   order by seq desc
   limit 1
     for update;

  new.prev_hash := v_prev_hash;

  v_payload := concat_ws('|',
    coalesce(v_prev_hash, 'GENESIS'),
    new.company_id::text,
    new.user_id::text,
    new.entry_type::text,
    to_char(new.event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSZ'),
    to_char(new.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSZ'),
    new.origin::text,
    coalesce(new.supersedes_id::text, ''),
    new.is_annulment::text,
    coalesce(new.reason, ''),
    new.created_by::text
  );

  new.entry_hash := encode(digest(v_payload, 'sha256'), 'hex');
  return new;
end;
$$;

create trigger time_entries_seal
  before insert on public.time_entries
  for each row execute function public.seal_time_entry();

-- Verificación de integridad: recalcula la cadena y devuelve los asientos
-- cuyo sello no cuadra. En un registro sano devuelve cero filas.
create or replace function public.verify_ledger(p_company_id uuid)
returns table (
  entry_id      uuid,
  seq           bigint,
  event_at      timestamptz,
  expected_hash text,
  stored_hash   text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  r         record;
  v_prev    text := null;
  v_payload text;
  v_hash    text;
begin
  for r in
    select * from public.time_entries
     where company_id = p_company_id
     order by seq
  loop
    v_payload := concat_ws('|',
      coalesce(v_prev, 'GENESIS'),
      r.company_id::text,
      r.user_id::text,
      r.entry_type::text,
      to_char(r.event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSZ'),
      to_char(r.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MSZ'),
      r.origin::text,
      coalesce(r.supersedes_id::text, ''),
      r.is_annulment::text,
      coalesce(r.reason, ''),
      r.created_by::text
    );
    v_hash := encode(digest(v_payload, 'sha256'), 'hex');

    if v_hash is distinct from r.entry_hash or r.prev_hash is distinct from v_prev then
      entry_id := r.id; seq := r.seq; event_at := r.event_at;
      expected_hash := v_hash; stored_hash := r.entry_hash;
      return next;
    end if;

    v_prev := r.entry_hash;
  end loop;
end;
$$;

comment on function public.verify_ledger(uuid) is
  'Prueba de integridad para Inspección de Trabajo: recalcula la cadena hash completa. '
  'Cero filas = registro íntegro y no manipulado.';

-- ---------------------------------------------------------------------
-- 3) AUDITORÍA AUTOMÁTICA
-- Cada asiento genera su registro de auditoría; los de rectificación
-- guardan hora original, hora nueva, motivo y autor.
-- ---------------------------------------------------------------------
create or replace function public.audit_time_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev   public.time_entries%rowtype;
  v_role   public.user_role;
  v_action text;
begin
  select role into v_role from public.profiles where id = new.created_by;

  if new.supersedes_id is null then
    v_action := 'create';
  elsif new.is_annulment then
    v_action := 'annul';
  else
    v_action := 'correct';
  end if;

  if new.supersedes_id is not null then
    select * into v_prev from public.time_entries where id = new.supersedes_id;
  end if;

  insert into public.time_entry_audits (
    company_id, entry_id, previous_entry_id, action,
    old_event_at, new_event_at, old_entry_type, new_entry_type,
    old_snapshot, new_snapshot, reason,
    actor_id, actor_role, actor_ip
  ) values (
    new.company_id, new.id, new.supersedes_id, v_action,
    v_prev.event_at,
    case when new.is_annulment then null else new.event_at end,
    v_prev.entry_type,
    case when new.is_annulment then null else new.entry_type end,
    case when v_prev.id is null then null else to_jsonb(v_prev) end,
    to_jsonb(new),
    new.reason,
    new.created_by, coalesce(v_role, 'employee'), new.ip_address
  );

  return null;
end;
$$;

create trigger time_entries_audit
  after insert on public.time_entries
  for each row execute function public.audit_time_entry();

-- ---------------------------------------------------------------------
-- 4) COHERENCIA DE LA CADENA DE RECTIFICACIÓN
-- Nadie puede rectificar un asiento de otra empresa, ya rectificado,
-- o cambiando de persona trabajadora.
-- ---------------------------------------------------------------------
create or replace function public.validate_supersede()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.time_entries%rowtype;
begin
  if new.supersedes_id is null then
    return new;
  end if;

  select * into v_target from public.time_entries where id = new.supersedes_id for update;

  if not found then
    raise exception 'El asiento a rectificar no existe.' using errcode = 'foreign_key_violation';
  end if;

  if v_target.company_id <> new.company_id or v_target.user_id <> new.user_id then
    raise exception 'Una rectificación no puede cambiar de empresa ni de persona trabajadora.'
      using errcode = 'restrict_violation';
  end if;

  if v_target.is_annulment then
    raise exception 'No se puede rectificar un asiento de anulación.'
      using errcode = 'restrict_violation';
  end if;

  if new.origin not in ('correction', 'admin_manual') then
    raise exception 'Toda rectificación debe registrarse con origen correction o admin_manual.'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger time_entries_validate_supersede
  before insert on public.time_entries
  for each row execute function public.validate_supersede();

-- ---------------------------------------------------------------------
-- 5) VISTA EFECTIVA — la "foto" vigente del registro
-- Un asiento está vigente si no ha sido sustituido y no es una anulación.
-- Los asientos históricos NO desaparecen: siguen en time_entries.
-- ---------------------------------------------------------------------
create or replace view public.effective_entries
with (security_invoker = true) as
select
  e.id, e.company_id, e.user_id, e.entry_type, e.event_at, e.recorded_at,
  e.work_date, e.origin, e.supersedes_id, e.reason,
  e.latitude, e.longitude, e.accuracy_m, e.created_by, e.entry_hash, e.seq,
  (e.supersedes_id is not null) as is_corrected,
  exists (
    select 1 from public.time_entry_audits a where a.entry_id = e.id and a.action <> 'create'
  ) as has_audit_trail
from public.time_entries e
where e.is_annulment = false
  and not exists (
    select 1 from public.time_entries s where s.supersedes_id = e.id
  );

comment on view public.effective_entries is
  'Fichajes vigentes tras aplicar la cadena de rectificaciones. Los asientos '
  'sustituidos permanecen íntegros en time_entries y son consultables.';

-- ---------------------------------------------------------------------
-- 6) CÁLCULO DE JORNADA — emparejado de entradas, pausas y salidas
-- ---------------------------------------------------------------------
create or replace function public.daily_summary(
  p_user_id uuid,
  p_from    date,
  p_to      date
)
returns table (
  work_date       date,
  first_in        timestamptz,
  last_out        timestamptz,
  worked_seconds  bigint,
  break_seconds   bigint,
  is_open         boolean,
  entry_count     integer,
  has_corrections boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  -- La ventana se ensancha un día por cada lado para que un turno nocturno
  -- (p. ej. 22:00 → 06:00) encuentre su evento de cierre, que cae en la
  -- fecha natural siguiente. Cada tramo se imputa al día de su evento inicial.
  with ordered as (
    select
      e.work_date, e.entry_type, e.event_at, e.is_corrected,
      lead(e.event_at) over (order by e.event_at, e.seq) as next_at
    from public.effective_entries e
    where e.user_id = p_user_id
      and e.work_date between p_from - 1 and p_to + 1
  ),
  scoped as (
    select * from ordered where work_date between p_from and p_to
  )
  select
    s.work_date,
    min(s.event_at) filter (where s.entry_type = 'clock_in')  as first_in,
    max(s.event_at) filter (where s.entry_type = 'clock_out') as last_out,
    -- Trabajo efectivo: de 'clock_in'/'break_end' hasta el siguiente evento.
    -- Un tramo sin cierre aporta 0: la jornada en curso se cuenta en vivo en el cliente.
    coalesce(sum(
      extract(epoch from (s.next_at - s.event_at))::bigint
    ) filter (where s.entry_type in ('clock_in', 'break_end') and s.next_at is not null), 0) as worked_seconds,
    -- Pausas: de 'break_start' hasta el siguiente evento.
    coalesce(sum(
      extract(epoch from (s.next_at - s.event_at))::bigint
    ) filter (where s.entry_type = 'break_start' and s.next_at is not null), 0) as break_seconds,
    -- Jornada abierta o fichaje de salida olvidado: hay un tramo sin cierre.
    bool_or(s.next_at is null and s.entry_type <> 'clock_out') as is_open,
    count(*)::integer as entry_count,
    bool_or(s.is_corrected) as has_corrections
  from scoped s
  group by s.work_date
  order by s.work_date;
$$;

comment on function public.daily_summary(uuid, date, date) is
  'Resumen diario de jornada efectiva a partir de los fichajes vigentes.';

-- ---------------------------------------------------------------------
-- 7) RETENCIÓN — purga que se niega a borrar antes de tiempo
-- ---------------------------------------------------------------------
create or replace function public.purge_expired_entries(p_company_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_years integer;
  v_count integer;
begin
  select retention_years into v_years from public.companies where id = p_company_id;
  if v_years is null then
    raise exception 'Empresa inexistente.';
  end if;

  select count(*) into v_count
    from public.time_entries
   where company_id = p_company_id
     and event_at < now() - make_interval(years => v_years);

  -- Deliberadamente NO se borra: el borrado exige desactivar temporalmente los
  -- triggers de inalterabilidad, y eso debe ser un acto humano documentado.
  -- Esta función solo informa de qué sería purgable pasado el plazo legal.
  raise notice 'Asientos fuera del plazo de conservación de % años: %', v_years, v_count;
  return v_count;
end;
$$;

comment on function public.purge_expired_entries(uuid) is
  'Informa (no borra) de los asientos que superan el plazo de conservación. '
  'El borrado real exige intervención humana documentada.';
