-- =====================================================================
--  FICHAJE MyL — Avisos de cambio para la sincronización en vivo
--
--  En Supabase la difusión en tiempo real la daba la plataforma. Aquí la da
--  PostgreSQL con NOTIFY, y el servidor la reenvía a los navegadores
--  conectados por SSE.
--
--  Por el canal viaja SOLO el identificador de la empresa y el de la persona
--  afectada: ningún dato de jornada. El navegador que recibe el aviso vuelve
--  a pedir lo que le corresponda, y esa petición pasa otra vez por la RLS.
--  Difundir el contenido del fichaje habría sido más rápido y habría abierto
--  un camino por el que salen datos sin control de permisos.
-- =====================================================================

create or replace function public.avisar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_company uuid;
  v_user    uuid;
begin
  if tg_op = 'DELETE' then
    v_company := old.company_id;
    v_user    := case when tg_table_name = 'profiles' then old.id else old.user_id end;
  else
    v_company := new.company_id;
    v_user    := case when tg_table_name = 'profiles' then new.id else new.user_id end;
  end if;

  -- `pg_notify` tiene un límite de 8000 bytes por carga; aquí sobra de largo.
  perform pg_notify(
    'fichaje_cambio',
    json_build_object(
      'tabla', tg_table_name,
      'company_id', v_company,
      'user_id', v_user
    )::text
  );

  return null; -- disparador AFTER: el valor devuelto se ignora
end $$;

drop trigger if exists time_entries_aviso on public.time_entries;
create trigger time_entries_aviso
  after insert on public.time_entries
  for each row execute function public.avisar_cambio();

drop trigger if exists correction_requests_aviso on public.correction_requests;
create trigger correction_requests_aviso
  after insert or update on public.correction_requests
  for each row execute function public.avisar_cambio();

drop trigger if exists profiles_aviso on public.profiles;
create trigger profiles_aviso
  after update on public.profiles
  for each row execute function public.avisar_cambio();
