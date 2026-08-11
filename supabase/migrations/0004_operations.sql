-- =====================================================================
--  FICHAJE MyL — Operaciones transaccionales (RPC)
--  Toda escritura relevante pasa por aquí para que la validación de la
--  máquina de estados y la auditoría no dependan del cliente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Estado actual de una persona, derivado del último asiento vigente
-- ---------------------------------------------------------------------
create or replace function public.current_state(p_user_id uuid)
returns public.entry_type
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select e.entry_type
    from public.effective_entries e
   where e.user_id = p_user_id
     -- Una jornada no puede quedar "abierta" indefinidamente: pasadas 20 h
     -- sin cerrar se considera fuera de jornada y requiere rectificación.
     and e.event_at > now() - interval '20 hours'
   order by e.event_at desc, e.seq desc
   limit 1;
$$;

-- ---------------------------------------------------------------------
-- punch() — fichar. Valida la transición antes de escribir.
-- ---------------------------------------------------------------------
create or replace function public.punch(
  p_entry_type public.entry_type,
  p_event_at   timestamptz default now(),
  p_latitude   numeric default null,
  p_longitude  numeric default null,
  p_accuracy   numeric default null,
  p_device     text default null,
  p_offline    boolean default false
)
returns public.time_entries
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_company public.companies%rowtype;
  v_state   public.entry_type;
  v_entry   public.time_entries%rowtype;
  v_geo_ok  boolean;
begin
  select * into v_profile from public.profiles where id = auth.uid();
  if not found or not v_profile.active then
    raise exception 'Usuario no válido o dado de baja.' using errcode = 'insufficient_privilege';
  end if;
  if v_profile.role = 'inspector' then
    raise exception 'El rol de inspección es de solo lectura y no puede fichar.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_company from public.companies where id = v_profile.company_id;

  -- Máquina de estados: qué transiciones son legales.
  v_state := public.current_state(auth.uid());

  if p_entry_type = 'clock_in' and v_state in ('clock_in', 'break_start', 'break_end') then
    raise exception 'Ya tiene una jornada abierta.' using errcode = 'check_violation';
  end if;
  if p_entry_type = 'break_start' and v_state is distinct from 'clock_in'
     and v_state is distinct from 'break_end' then
    raise exception 'Solo puede iniciar una pausa con la jornada en curso.' using errcode = 'check_violation';
  end if;
  if p_entry_type = 'break_end' and v_state is distinct from 'break_start' then
    raise exception 'No hay ninguna pausa activa que reanudar.' using errcode = 'check_violation';
  end if;
  if p_entry_type = 'clock_out' and (v_state is null or v_state = 'clock_out') then
    raise exception 'No hay ninguna jornada abierta que cerrar.' using errcode = 'check_violation';
  end if;

  -- Geolocalización: solo se almacena si la empresa la ha activado Y la
  -- persona ha dado su consentimiento (RGPD art. 7 · LOPDGDD art. 90).
  v_geo_ok := v_company.geolocation_policy <> 'disabled'
              and v_profile.geo_consent
              and p_latitude is not null
              and p_longitude is not null;

  if v_company.geolocation_policy = 'required' and not v_geo_ok then
    raise exception 'Esta empresa exige registrar la ubicación al fichar.'
      using errcode = 'check_violation';
  end if;

  insert into public.time_entries (
    company_id, user_id, entry_type, event_at, work_date, origin,
    latitude, longitude, accuracy_m, geo_consent,
    created_by, device_label, user_agent, ip_address
  ) values (
    v_profile.company_id, v_profile.id, p_entry_type, p_event_at,
    current_date,  -- recalculado por el trigger de sellado con el huso de la empresa
    (case when p_offline then 'employee_offline' else 'employee_app' end)::public.entry_origin,
    case when v_geo_ok then p_latitude end,
    case when v_geo_ok then p_longitude end,
    case when v_geo_ok then p_accuracy end,
    v_geo_ok,
    v_profile.id, p_device,
    current_setting('request.headers', true)::json ->> 'user-agent',
    nullif(current_setting('request.headers', true)::json ->> 'x-forwarded-for', '')::inet
  )
  returning * into v_entry;

  return v_entry;
end;
$$;

comment on function public.punch is
  'Único punto de entrada para fichar. Valida la transición de estado, aplica la '
  'política de geolocalización de la empresa y delega el sellado en el trigger.';

-- ---------------------------------------------------------------------
-- review_correction() — aprobar o rechazar una solicitud de rectificación
-- Aprobar genera el asiento de corrección; nunca toca el original.
-- ---------------------------------------------------------------------
create or replace function public.review_correction(
  p_request_id uuid,
  p_approve    boolean,
  p_note       text default null
)
returns public.correction_requests
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_req     public.correction_requests%rowtype;
  v_reviewer public.profiles%rowtype;
  v_entry   public.time_entries%rowtype;
begin
  select * into v_reviewer from public.profiles where id = auth.uid();
  if v_reviewer.role not in ('admin', 'manager') then
    raise exception 'Solo administración puede resolver solicitudes de rectificación.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.correction_requests
   where id = p_request_id and company_id = v_reviewer.company_id
   for update;

  if not found then
    raise exception 'Solicitud no encontrada.' using errcode = 'no_data_found';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'La solicitud ya fue resuelta (estado: %).', v_req.status
      using errcode = 'check_violation';
  end if;
  -- Cuatro ojos: quien solicita no puede aprobarse a sí mismo.
  if v_req.user_id = auth.uid() then
    raise exception 'No puede aprobar su propia solicitud de rectificación.'
      using errcode = 'insufficient_privilege';
  end if;

  if not p_approve then
    update public.correction_requests
       set status = 'rejected', reviewed_by = auth.uid(),
           reviewed_at = now(), review_note = p_note
     where id = p_request_id
     returning * into v_req;
    return v_req;
  end if;

  -- Asiento nuevo: sustituye al original (si lo hay) o lo añade si faltaba.
  insert into public.time_entries (
    company_id, user_id, entry_type, event_at, work_date, origin,
    supersedes_id, reason, correction_request_id, created_by
  ) values (
    v_req.company_id, v_req.user_id, v_req.requested_type, v_req.requested_event_at,
    v_req.work_date, 'correction',
    v_req.target_entry_id,
    'Rectificación aprobada. Motivo alegado por la persona trabajadora: '
      || v_req.reason
      || coalesce(' // Nota de administración: ' || nullif(btrim(p_note), ''), ''),
    v_req.id, auth.uid()
  )
  returning * into v_entry;

  update public.correction_requests
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
         review_note = p_note, resulting_entry_id = v_entry.id
   where id = p_request_id
   returning * into v_req;

  return v_req;
end;
$$;

-- ---------------------------------------------------------------------
-- annul_entry() — anular un fichaje erróneo sin sustituirlo
-- ---------------------------------------------------------------------
create or replace function public.annul_entry(p_entry_id uuid, p_reason text)
returns public.time_entries
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_target public.time_entries%rowtype;
  v_actor  public.profiles%rowtype;
  v_new    public.time_entries%rowtype;
begin
  select * into v_actor from public.profiles where id = auth.uid();
  if v_actor.role not in ('admin', 'manager') then
    raise exception 'Solo administración puede anular un fichaje.' using errcode = 'insufficient_privilege';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'La anulación exige un motivo documentado de al menos 10 caracteres.'
      using errcode = 'check_violation';
  end if;

  select * into v_target from public.time_entries
   where id = p_entry_id and company_id = v_actor.company_id;
  if not found then
    raise exception 'Fichaje no encontrado.' using errcode = 'no_data_found';
  end if;

  insert into public.time_entries (
    company_id, user_id, entry_type, event_at, work_date, origin,
    supersedes_id, is_annulment, reason, created_by
  ) values (
    v_target.company_id, v_target.user_id, v_target.entry_type, v_target.event_at,
    v_target.work_date, 'correction', v_target.id, true, p_reason, auth.uid()
  )
  returning * into v_new;

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------
-- Panel en vivo de la plantilla (vista de administración)
-- ---------------------------------------------------------------------
create or replace view public.staff_live_status
with (security_invoker = true) as
select
  p.id            as user_id,
  p.company_id,
  p.full_name,
  p.employee_number,
  p.contract_hours,
  last_entry.entry_type as last_action,
  last_entry.event_at   as last_action_at,
  case
    when last_entry.entry_type is null then 'off'
    when last_entry.event_at < now() - interval '20 hours' then 'off'
    when last_entry.entry_type = 'clock_out' then 'off'
    when last_entry.entry_type = 'break_start' then 'break'
    else 'working'
  end as status
from public.profiles p
left join lateral (
  select e.entry_type, e.event_at
    from public.effective_entries e
   where e.user_id = p.id
   order by e.event_at desc, e.seq desc
   limit 1
) last_entry on true
where p.active;

-- ---------------------------------------------------------------------
-- Informe mensual (base de las exportaciones PDF/Excel)
-- ---------------------------------------------------------------------
create or replace function public.monthly_report(
  p_company_id uuid,
  p_year       integer,
  p_month      integer,
  p_user_id    uuid default null
)
returns table (
  user_id         uuid,
  full_name       text,
  employee_number text,
  contract_hours  numeric,
  work_date       date,
  first_in        timestamptz,
  last_out        timestamptz,
  worked_seconds  bigint,
  break_seconds   bigint,
  has_corrections boolean,
  is_open         boolean
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    p.id, p.full_name, p.employee_number, p.contract_hours,
    d.work_date, d.first_in, d.last_out, d.worked_seconds, d.break_seconds,
    d.has_corrections, d.is_open
  from public.profiles p
  cross join lateral public.daily_summary(
    p.id,
    make_date(p_year, p_month, 1),
    (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date
  ) d
  where p.company_id = p_company_id
    and (p_user_id is null or p.id = p_user_id)
  order by p.full_name, d.work_date;
$$;
