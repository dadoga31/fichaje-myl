-- =====================================================================
--  PRUEBAS DE CUMPLIMIENTO — Art. 34.9 ET / RDL 8/2019
--
--  No son pruebas unitarias decorativas: cada bloque intenta ACTIVAMENTE
--  romper una garantía legal y falla ruidosamente si lo consigue.
--  Ejecutar con:  psql -v ON_ERROR_STOP=1 -f 01_compliance_test.sql
-- =====================================================================

\set QUIET on
\set ON_ERROR_STOP on
set client_min_messages to notice;

-- Los resultados de las consultas no interesan: el informe de la batería son
-- los NOTICE de las aserciones (stderr) y los \echo de sección (stdout).
\o /dev/null

-- Utilidad de aserción.
create or replace function pg_temp.assert(p_cond boolean, p_label text)
returns void language plpgsql as $$
begin
  if not p_cond then
    raise exception 'FALLO: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end $$;

-- Ejecuta un SQL que DEBE fallar. Si no falla, la garantía está rota.
create or replace function pg_temp.assert_fails(p_sql text, p_label text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    raise notice '  ok  % [bloqueado: %]', p_label, left(sqlerrm, 60);
    return;
  end;
  raise exception 'FALLO: % — la operación debía ser rechazada y fue aceptada.', p_label;
end $$;

-- ---------------------------------------------------------------------
-- Datos de partida: dos empresas, para probar también el aislamiento.
-- ---------------------------------------------------------------------
\echo ''
\echo '--- Preparando escenario de prueba ---'

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@acme.test'),
  ('22222222-2222-2222-2222-222222222222', 'rrhh@acme.test'),
  ('33333333-3333-3333-3333-333333333333', 'espia@otra.test'),
  ('44444444-4444-4444-4444-444444444444', 'inspeccion@acme.test');

insert into public.companies (id, name, cif, geolocation_policy) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'ACME Servicios SL', 'B12345678', 'disabled'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Otra Empresa SA',   'B87654321', 'disabled');

insert into public.profiles (id, company_id, full_name, email, role, employee_number) values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ana Pérez',    'ana@acme.test',        'employee',  'E-001'),
  ('22222222-2222-2222-2222-222222222222', 'aaaaaaaa-0000-0000-0000-000000000001', 'Luis RRHH',    'rrhh@acme.test',       'admin',     'A-001'),
  ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-0000-0000-0000-000000000002', 'Espía Rival',  'espia@otra.test',      'admin',     'X-001'),
  ('44444444-4444-4444-4444-444444444444', 'aaaaaaaa-0000-0000-0000-000000000001', 'Inspección',   'inspeccion@acme.test', 'inspector', 'I-001');

-- Helper para "iniciar sesión" como un usuario concreto bajo RLS.
create or replace function pg_temp.login(p_uid text)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, false);
  execute 'set local role authenticated';
end $$;

-- ---------------------------------------------------------------------
-- 1. FICHAJE NORMAL Y MÁQUINA DE ESTADOS
-- ---------------------------------------------------------------------
\echo ''
\echo '--- 1. Fichaje y máquina de estados ---'

begin;
select pg_temp.login('11111111-1111-1111-1111-111111111111');

select public.punch('clock_in',    now() - interval '4 hours');
select pg_temp.assert(public.current_state(auth.uid()) = 'clock_in', 'Tras entrar, el estado es "en jornada"');

select pg_temp.assert_fails(
  $$select public.punch('clock_in', now())$$,
  'No se puede fichar entrada dos veces seguidas');

select pg_temp.assert_fails(
  $$select public.punch('break_end', now())$$,
  'No se puede reanudar sin pausa activa');

select public.punch('break_start', now() - interval '2 hours');
select pg_temp.assert(public.current_state(auth.uid()) = 'break_start', 'Tras pausar, el estado es "en pausa"');

select public.punch('break_end',   now() - interval '1 hour 30 minutes');
select public.punch('clock_out',   now() - interval '10 minutes');
select pg_temp.assert(public.current_state(auth.uid()) = 'clock_out', 'Tras salir, el estado es "fuera de jornada"');

select pg_temp.assert_fails(
  $$select public.punch('clock_out', now())$$,
  'No se puede fichar salida sin jornada abierta');

-- Presencia de 3h50 (de -4h a -10min) menos 30 min de pausa = 3h20 efectivas.
select pg_temp.assert(
  abs(worked_seconds - (3 * 3600 + 20 * 60)) < 120 and abs(break_seconds - 1800) < 120,
  'El cómputo de jornada descuenta la pausa correctamente ('
    || round(worked_seconds / 3600.0, 2) || ' h trabajadas, '
    || round(break_seconds / 60.0) || ' min de pausa)')
from public.daily_summary(
  '11111111-1111-1111-1111-111111111111'::uuid, current_date - 1, current_date)
where worked_seconds > 0;
commit;

-- ---------------------------------------------------------------------
-- 2. INALTERABILIDAD — el núcleo del Art. 34.9 ET
-- ---------------------------------------------------------------------
\echo ''
\echo '--- 2. Inalterabilidad del registro ---'

begin;
select pg_temp.login('22222222-2222-2222-2222-222222222222');  -- admin de RRHH

select pg_temp.assert_fails(
  $$update public.time_entries set event_at = now() where entry_type = 'clock_in'$$,
  'Ni siquiera RRHH puede MODIFICAR un fichaje');

select pg_temp.assert_fails(
  $$delete from public.time_entries$$,
  'Ni siquiera RRHH puede BORRAR un fichaje');

select pg_temp.assert_fails(
  $$update public.time_entry_audits set reason = 'tapado'$$,
  'El historial de auditoría tampoco se puede alterar');

select pg_temp.assert_fails(
  $$delete from public.time_entry_audits$$,
  'El historial de auditoría no se puede borrar');
commit;

-- El propietario de la tabla (superusuario, acceso directo al SQL) también
-- choca con el trigger: la barrera no depende solo de los permisos.
begin;
select pg_temp.assert_fails(
  $$update public.time_entries set event_at = now() - interval '9 hours'$$,
  'El superusuario con acceso directo al SQL también es rechazado');

select pg_temp.assert_fails(
  $$truncate public.time_entries$$,
  'TRUNCATE está bloqueado');
commit;

-- ---------------------------------------------------------------------
-- 3. RECTIFICACIÓN CON AUDITORÍA
-- ---------------------------------------------------------------------
\echo ''
\echo '--- 3. Rectificación de un fichaje olvidado, con auditoría ---'

begin;
-- Ana olvidó fichar la salida y la registró tarde: solicita rectificarla.
select pg_temp.login('11111111-1111-1111-1111-111111111111');

insert into public.correction_requests (
  company_id, user_id, target_entry_id, requested_type, requested_event_at, work_date, reason)
select e.company_id, e.user_id, e.id, 'clock_out',
       e.event_at - interval '55 minutes', e.work_date,
       'Olvidé fichar la salida al terminar; salí a las 17:00 según el registro de la puerta.'
  from public.effective_entries e
 where e.user_id = auth.uid() and e.entry_type = 'clock_out'
 order by e.event_at desc limit 1;

select pg_temp.assert_fails(
  $$select public.review_correction(
      (select id from public.correction_requests order by created_at desc limit 1), true)$$,
  'Una persona empleada no puede resolver solicitudes de rectificación');
commit;

-- Regla de los cuatro ojos: ni siquiera un administrador puede aprobar su
-- PROPIA solicitud, aunque tenga permisos para aprobar las de los demás.
begin;
select pg_temp.login('22222222-2222-2222-2222-222222222222');
select public.punch('clock_in', now() - interval '3 hours');

insert into public.correction_requests (
  company_id, user_id, target_entry_id, requested_type, requested_event_at, work_date, reason)
select e.company_id, e.user_id, e.id, 'clock_in', e.event_at - interval '30 minutes', e.work_date,
       'Entré antes de lo que refleja el sistema, ajusto mi propia hora de entrada.'
  from public.effective_entries e
 where e.user_id = auth.uid() and e.entry_type = 'clock_in'
 order by e.event_at desc limit 1;

select pg_temp.assert_fails(
  $$select public.review_correction(
      (select id from public.correction_requests
        where user_id = '22222222-2222-2222-2222-222222222222' order by created_at desc limit 1), true)$$,
  'Un administrador NO puede aprobar su propia rectificación (regla de los cuatro ojos)');
rollback;

begin;
select pg_temp.login('22222222-2222-2222-2222-222222222222');  -- RRHH aprueba

select public.review_correction(
  (select id from public.correction_requests where status = 'pending' order by created_at desc limit 1),
  true,
  'Verificado contra el control de accesos del edificio.');

-- El asiento ORIGINAL sigue existiendo: no se ha sobrescrito nada.
select pg_temp.assert(count(*) = 2, 'El fichaje original y su rectificación coexisten en el libro')
  from public.time_entries where entry_type = 'clock_out';

-- Pero solo la versión vigente aparece en la vista efectiva.
select pg_temp.assert(count(*) = 1, 'La vista efectiva muestra solo la versión vigente')
  from public.effective_entries where entry_type = 'clock_out';

-- La auditoría contiene hora original, hora nueva, motivo y autor.
select pg_temp.assert(
  a.old_event_at is not null
  and a.new_event_at is not null
  and a.old_event_at <> a.new_event_at
  and a.reason ilike '%Olvidé fichar la salida%'
  and a.actor_id = '22222222-2222-2222-2222-222222222222'
  and a.actor_role = 'admin'
  and a.old_snapshot is not null,
  'La auditoría registra hora original ('
    || to_char(a.old_event_at, 'HH24:MI') || '), hora rectificada ('
    || to_char(a.new_event_at, 'HH24:MI') || '), motivo y autor')
from public.time_entry_audits a where a.action = 'correct';
commit;

-- ---------------------------------------------------------------------
-- 4. AISLAMIENTO ENTRE EMPRESAS Y ENTRE PERSONAS (RLS)
-- ---------------------------------------------------------------------
\echo ''
\echo '--- 4. Aislamiento de datos (RLS) ---'

begin;
select pg_temp.login('33333333-3333-3333-3333-333333333333');  -- admin de OTRA empresa
select pg_temp.assert(count(*) = 0, 'Un administrador de otra empresa no ve ningún fichaje ajeno')
  from public.time_entries;
select pg_temp.assert(count(*) = 0, 'Tampoco ve auditorías ajenas')
  from public.time_entry_audits;
commit;

begin;
select pg_temp.login('44444444-4444-4444-4444-444444444444');  -- Inspección de Trabajo
select pg_temp.assert(count(*) > 0, 'La Inspección SÍ ve los registros de la empresa')
  from public.time_entries;
select pg_temp.assert_fails(
  $$select public.punch('clock_in', now())$$,
  'El rol de Inspección es de solo lectura: no puede fichar');
select pg_temp.assert_fails(
  $$insert into public.correction_requests (company_id, user_id, requested_type, requested_event_at, work_date, reason)
    values (public.current_company_id(), auth.uid(), 'clock_in', now(), current_date, 'intento de escritura')$$,
  'El rol de Inspección no puede crear solicitudes');
commit;

-- ---------------------------------------------------------------------
-- 5. SELLADO DE INTEGRIDAD (cadena hash)
-- ---------------------------------------------------------------------
\echo ''
\echo '--- 5. Sellado de integridad ---'

begin;
select pg_temp.assert(count(*) = 0, 'La cadena hash del registro es íntegra (verify_ledger no detecta anomalías)')
  from public.verify_ledger('aaaaaaaa-0000-0000-0000-000000000001');

select pg_temp.assert(
  bool_and(entry_hash is not null and length(entry_hash) = 64),
  'Todo asiento lleva su sello SHA-256')
  from public.time_entries;

select pg_temp.assert(count(*) = 1, 'Existe exactamente un asiento génesis sin eslabón previo')
  from public.time_entries where prev_hash is null;
commit;

-- Simulacro forense: un atacante con acceso total a la base desactiva los
-- triggers y falsea una hora. La cadena hash lo delata.
\echo ''
\echo '--- 5b. Simulacro: manipulación directa en base de datos ---'
begin;
alter table public.time_entries disable trigger user;
update public.time_entries
   set event_at = event_at - interval '2 hours'
 where id = (select id from public.time_entries order by seq limit 1);
alter table public.time_entries enable trigger user;

select pg_temp.assert(count(*) > 0,
  'La manipulación directa en base de datos ES DETECTADA por verify_ledger ('
    || count(*) || ' asiento(s) con sello incoherente)')
  from public.verify_ledger('aaaaaaaa-0000-0000-0000-000000000001');
rollback;  -- se deshace el simulacro

-- ---------------------------------------------------------------------
-- 6. GARANTÍAS DE FORMA EN LAS RECTIFICACIONES
-- ---------------------------------------------------------------------
\echo ''
\echo '--- 6. Requisitos formales de la rectificación ---'

begin;
select pg_temp.login('22222222-2222-2222-2222-222222222222');

select pg_temp.assert_fails(
  $$insert into public.time_entries (company_id, user_id, entry_type, event_at, work_date, origin, supersedes_id, created_by)
    select company_id, user_id, entry_type, event_at, work_date, 'correction', id, auth.uid()
      from public.time_entries order by seq limit 1$$,
  'Una rectificación SIN motivo documentado es rechazada');

select pg_temp.assert_fails(
  $$select public.annul_entry((select id from public.time_entries order by seq limit 1), 'error')$$,
  'Una anulación con motivo insuficiente es rechazada');

-- Los fichajes existentes son de Ana; se intenta rectificar uno atribuyéndoselo
-- a Luis. Debe rechazarse: una rectificación jamás cambia de titular.
select pg_temp.assert_fails(
  $$insert into public.time_entries (company_id, user_id, entry_type, event_at, work_date, origin, supersedes_id, reason, created_by)
    select company_id, '22222222-2222-2222-2222-222222222222', entry_type, event_at, work_date, 'correction', id,
           'Intento de reasignar el fichaje a otra persona trabajadora', auth.uid()
      from public.time_entries
     where user_id = '11111111-1111-1111-1111-111111111111'
       and not exists (select 1 from public.time_entries s where s.supersedes_id = time_entries.id)
     order by seq limit 1$$,
  'Una rectificación no puede reasignar el fichaje a otra persona');

-- Un asiento ya rectificado no puede volver a rectificarse: la cadena es lineal
-- y evita versiones paralelas del mismo hecho.
select pg_temp.assert_fails(
  $$insert into public.time_entries (company_id, user_id, entry_type, event_at, work_date, origin, supersedes_id, reason, created_by)
    select e.company_id, e.user_id, e.entry_type, e.event_at, e.work_date, 'correction', e.id,
           'Segunda rectificación sobre un asiento ya sustituido', auth.uid()
      from public.time_entries e
     where exists (select 1 from public.time_entries s where s.supersedes_id = e.id)
     limit 1$$,
  'Un asiento ya rectificado no admite una segunda rectificación paralela');
commit;

-- ---------------------------------------------------------------------
-- 7. CONSERVACIÓN Y GEOLOCALIZACIÓN
-- ---------------------------------------------------------------------
\echo ''
\echo '--- 7. Conservación de datos y geolocalización ---'

begin;
select pg_temp.assert_fails(
  $$update public.companies set retention_years = 2
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'No se puede configurar una conservación inferior a 4 años');

select pg_temp.assert_fails(
  $$update public.companies set geolocation_policy = 'required'
     where id = 'aaaaaaaa-0000-0000-0000-000000000001'$$,
  'No se puede activar la geolocalización sin publicar el aviso informativo');

select pg_temp.assert_fails(
  $$insert into public.time_entries (company_id, user_id, entry_type, event_at, work_date, origin, latitude, longitude, geo_consent, created_by)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
            'clock_in', now(), current_date, 'employee_app', 40.4168, -3.7038, false,
            '11111111-1111-1111-1111-111111111111')$$,
  'No se almacenan coordenadas sin consentimiento explícito');

select pg_temp.assert(
  bool_and(latitude is null and longitude is null),
  'Con la política "disabled", ningún fichaje guarda coordenadas')
  from public.time_entries;
commit;

\echo ''
\echo '======================================================='
\echo '  TODAS LAS PRUEBAS DE CUMPLIMIENTO HAN PASADO'
\echo '======================================================='
