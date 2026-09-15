-- =====================================================================
--  FICHAJE MyL — Esquema base (PostgreSQL / Supabase)
--  Registro de jornada conforme a:
--    · Art. 34.9 del Estatuto de los Trabajadores
--    · Real Decreto-ley 8/2019, de 8 de marzo
--    · RGPD (UE) 2016/679 y LO 3/2018 (LOPDGDD), art. 90 (geolocalización)
--
--  PRINCIPIO DE DISEÑO: el registro horario es un LIBRO DE ASIENTOS
--  (append-only ledger). Ningún fichaje se actualiza ni se borra jamás.
--  Una corrección es un asiento NUEVO que sustituye al anterior, y el
--  original permanece almacenado y consultable durante 4 años.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- ---------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------
create type public.user_role as enum (
  'employee',   -- persona trabajadora
  'manager',    -- responsable de equipo (lectura + aprobación de su equipo)
  'admin',      -- RRHH / administración de la empresa
  'inspector'   -- Inspección de Trabajo o RLT: SOLO LECTURA
);

create type public.entry_type as enum (
  'clock_in',    -- entrada
  'break_start', -- inicio de pausa / descanso
  'break_end',   -- fin de pausa (reanudar)
  'clock_out'    -- salida
);

create type public.entry_origin as enum (
  'employee_app',      -- fichaje en tiempo real por la persona trabajadora
  'employee_offline',  -- fichado sin red y sincronizado después (PWA)
  'admin_manual',      -- alta manual por administración
  'correction',        -- asiento de corrección aprobado
  'import'             -- migración desde sistema anterior
);

create type public.geolocation_policy as enum (
  'disabled',  -- la empresa no recoge ubicación (por defecto)
  'optional',  -- se solicita, la persona puede rechazarla sin consecuencia
  'required'   -- exigida (requiere justificación de proporcionalidad, art. 90 LOPDGDD)
);

create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- ---------------------------------------------------------------------
-- companies — empresa / centro de trabajo (multi-tenant)
-- ---------------------------------------------------------------------
create table public.companies (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  cif                 text        not null,
  timezone            text        not null default 'Europe/Madrid',
  -- Política de geolocalización. El aviso informativo es obligatorio si != 'disabled'.
  geolocation_policy  public.geolocation_policy not null default 'disabled',
  geolocation_notice  text,
  -- Art. 34.9 ET: conservación mínima de 4 años.
  retention_years     smallint    not null default 4 check (retention_years >= 4),
  -- Jornada de referencia para el cálculo de horas ordinarias vs. extraordinarias.
  weekly_hours        numeric(5,2) not null default 40.00,
  created_at          timestamptz not null default now(),

  constraint companies_geo_notice_required check (
    geolocation_policy = 'disabled' or (geolocation_notice is not null and length(geolocation_notice) > 20)
  )
);

comment on table public.companies is
  'Empresa. retention_years no puede bajar de 4 (Art. 34.9 ET).';

-- ---------------------------------------------------------------------
-- profiles — persona usuaria (1:1 con auth.users de Supabase)
-- ---------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete restrict,
  company_id       uuid not null references public.companies(id) on delete restrict,
  full_name        text not null,
  email            citext,
  role             public.user_role not null default 'employee',
  employee_number  text,
  nif              text,
  -- Horas de contrato semanales: base del cálculo de horas complementarias/extra.
  contract_hours   numeric(5,2) not null default 40.00,
  -- Consentimiento explícito e informado a la geolocalización (RGPD art. 7).
  geo_consent_at   timestamptz,
  geo_consent      boolean not null default false,
  active           boolean not null default true,
  hired_on         date,
  terminated_on    date,
  created_at       timestamptz not null default now(),

  unique (company_id, employee_number)
);

comment on column public.profiles.id is
  'No se borra nunca mientras existan fichajes: ON DELETE RESTRICT protege el registro.';

create index profiles_company_idx on public.profiles (company_id) where active;

-- ---------------------------------------------------------------------
-- time_entries — EL LIBRO DE FICHAJES (append-only, inalterable)
-- ---------------------------------------------------------------------
create table public.time_entries (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete restrict,
  user_id           uuid not null references public.profiles(id) on delete restrict,

  entry_type        public.entry_type not null,
  -- Momento al que se refiere el fichaje (el que cuenta a efectos laborales).
  event_at          timestamptz not null,
  -- Momento en que el sistema lo grabó (sellado por el servidor, no por el cliente).
  recorded_at       timestamptz not null default now(),
  -- Fecha natural de imputación, en el huso de la empresa.
  work_date         date not null,

  origin            public.entry_origin not null default 'employee_app',

  -- --- Cadena de rectificación -------------------------------------
  -- Un asiento de corrección apunta al asiento al que sustituye.
  supersedes_id     uuid references public.time_entries(id) on delete restrict,
  -- true = anula sin sustituir (fichaje registrado por error que no debe existir).
  is_annulment      boolean not null default false,
  -- Obligatorio en toda rectificación: el motivo documentado.
  reason            text,
  correction_request_id uuid,

  -- --- Geolocalización (opcional, art. 90 LOPDGDD) ------------------
  latitude          numeric(9,6),
  longitude         numeric(9,6),
  accuracy_m        numeric(7,1),
  geo_consent       boolean not null default false,

  -- --- Trazabilidad técnica -----------------------------------------
  created_by        uuid not null references public.profiles(id) on delete restrict,
  device_label      text,
  user_agent        text,
  ip_address        inet,

  -- --- Sellado de integridad (cadena hash tipo blockchain) ----------
  prev_hash         text,
  entry_hash        text not null,
  seq               bigint generated always as identity,

  created_at        timestamptz not null default now(),

  -- Toda rectificación exige motivo documentado (Art. 34.9 ET · trazabilidad).
  constraint time_entries_reason_required check (
    supersedes_id is null or (reason is not null and length(btrim(reason)) >= 10)
  ),
  -- Una anulación siempre apunta a un asiento previo.
  constraint time_entries_annulment_needs_target check (
    is_annulment = false or supersedes_id is not null
  ),
  -- Un asiento no puede sustituirse a sí mismo.
  constraint time_entries_no_self_reference check (supersedes_id is distinct from id),
  -- Coherencia del consentimiento: sin consentimiento no se almacenan coordenadas.
  constraint time_entries_geo_consent check (
    (latitude is null and longitude is null) or geo_consent = true
  ),
  -- Un asiento solo puede ser sustituido por UNO nuevo: evita cadenas ambiguas.
  unique (supersedes_id)
);

comment on table public.time_entries is
  'Libro de fichajes inmutable. UPDATE y DELETE están revocados y bloqueados por trigger. '
  'Rectificar = insertar un asiento nuevo con supersedes_id apuntando al anterior.';

create index time_entries_user_date_idx  on public.time_entries (user_id, work_date desc);
create index time_entries_company_idx    on public.time_entries (company_id, work_date desc);
create index time_entries_supersedes_idx on public.time_entries (supersedes_id) where supersedes_id is not null;
create index time_entries_event_idx      on public.time_entries (company_id, event_at desc);

-- ---------------------------------------------------------------------
-- time_entry_audits — HISTORIAL DE AUDITORÍA
-- Responde a: qué había antes, qué hay ahora, por qué, quién y cuándo.
-- ---------------------------------------------------------------------
create table public.time_entry_audits (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete restrict,
  entry_id         uuid not null references public.time_entries(id) on delete restrict,
  previous_entry_id uuid references public.time_entries(id) on delete restrict,

  action           text not null check (action in ('create', 'correct', 'annul', 'approve', 'reject')),

  -- Valores legalmente relevantes, en claro, para la Inspección.
  old_event_at     timestamptz,
  new_event_at     timestamptz,
  old_entry_type   public.entry_type,
  new_entry_type   public.entry_type,

  -- Instantánea íntegra de ambos asientos (prueba pericial).
  old_snapshot     jsonb,
  new_snapshot     jsonb,

  reason           text,
  actor_id         uuid not null references public.profiles(id) on delete restrict,
  actor_role       public.user_role not null,
  actor_ip         inet,
  created_at       timestamptz not null default now()
);

comment on table public.time_entry_audits is
  'Historial de auditoría: hora original, hora modificada, motivo, autor y momento. '
  'Se escribe automáticamente por trigger; tampoco admite UPDATE ni DELETE.';

create index time_entry_audits_entry_idx   on public.time_entry_audits (entry_id);
create index time_entry_audits_company_idx on public.time_entry_audits (company_id, created_at desc);

-- ---------------------------------------------------------------------
-- correction_requests — solicitudes de rectificación de la plantilla
-- ---------------------------------------------------------------------
create table public.correction_requests (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete restrict,
  user_id           uuid not null references public.profiles(id) on delete restrict,

  -- Nulo cuando se solicita AÑADIR un fichaje olvidado.
  target_entry_id   uuid references public.time_entries(id) on delete restrict,
  requested_type    public.entry_type not null,
  requested_event_at timestamptz not null,
  work_date         date not null,
  reason            text not null check (length(btrim(reason)) >= 10),

  status            public.request_status not null default 'pending',
  reviewed_by       uuid references public.profiles(id) on delete restrict,
  reviewed_at       timestamptz,
  review_note       text,
  -- Asiento generado al aprobar.
  resulting_entry_id uuid references public.time_entries(id) on delete restrict,
  created_at        timestamptz not null default now(),

  constraint correction_requests_review_complete check (
    status = 'pending' or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index correction_requests_pending_idx
  on public.correction_requests (company_id, status, created_at desc);
create index correction_requests_user_idx
  on public.correction_requests (user_id, created_at desc);

alter table public.time_entries
  add constraint time_entries_correction_request_fk
  foreign key (correction_request_id) references public.correction_requests(id) on delete restrict;

-- ---------------------------------------------------------------------
-- access_logs — quién ha consultado o exportado qué
-- Exigible de facto ante la RLT y útil para el registro de actividades RGPD.
-- ---------------------------------------------------------------------
create table public.access_logs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete restrict,
  actor_id     uuid not null references public.profiles(id) on delete restrict,
  actor_role   public.user_role not null,
  action       text not null,             -- 'export_pdf' | 'export_xlsx' | 'view_inspection' | ...
  subject_user_id uuid references public.profiles(id) on delete restrict,
  period_start date,
  period_end   date,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index access_logs_company_idx on public.access_logs (company_id, created_at desc);
