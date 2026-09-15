-- =====================================================================
--  FICHAJE MyL — Capa de identidad (PostgreSQL autoalojado)
--
--  Sustituye a la plataforma Supabase. Su razón de ser es que las cinco
--  migraciones siguientes —con los permisos revocados, los disparadores de
--  inalterabilidad, la cadena de hashes y toda la RLS— puedan aplicarse
--  SIN UN SOLO CAMBIO sobre un PostgreSQL normal.
--
--  Eso importa: esas migraciones son la parte del sistema que sostiene el
--  valor legal del producto y están respaldadas por una batería de pruebas.
--  Reescribirlas para autoalojar habría significado volver a validarlas
--  desde cero; adaptando el entorno a ellas, siguen siendo las mismas.
--
--  La pieza clave es `auth.uid()`: en Supabase lo derivaba del JWT; aquí lo
--  lee de una variable de sesión que el servidor fija al abrir cada
--  transacción. La RLS sigue funcionando exactamente igual.
-- =====================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

create schema if not exists auth;

-- ---------------------------------------------------------------------
-- auth.users — credenciales
--
-- Separada de `profiles` a propósito: los datos laborales de una persona y
-- su secreto de acceso no tienen por qué vivir en la misma tabla, y así
-- `profiles` puede consultarse sin arrastrar nunca el hash.
-- ---------------------------------------------------------------------
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               citext unique not null,
  -- Hash Argon2id calculado por el servidor. NUNCA la contraseña en claro.
  --
  -- Admite NULL, y es deliberado: una cuenta recién dada de alta a la que
  -- todavía no se le ha fijado contraseña es un estado legítimo. El acceso
  -- rechaza el NULL explícitamente, que es más seguro que sembrar la tabla
  -- con un hash por defecto que alguien pudiera acabar reutilizando.
  password_hash       text,
  -- Obliga a cambiarla en el primer acceso: las altas se crean con una
  -- contraseña provisional que conoce quien da de alta.
  must_change_password boolean not null default true,
  -- Freno a la fuerza bruta, evaluado también en el servidor.
  failed_attempts     smallint not null default 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- auth.uid() — quién está haciendo la petición
--
-- El servidor ejecuta `set local request.jwt.claim.sub = '<uuid>'` al abrir
-- la transacción de cada petición. Se usa el MISMO nombre de variable que
-- Supabase para que las políticas RLS no cambien.
--
-- `set local` y no `set`: el valor muere con la transacción, así que una
-- conexión devuelta al pool no puede arrastrar la identidad de la petición
-- anterior. Es la diferencia entre aislar de verdad y creer que se aísla.
-- ---------------------------------------------------------------------
create or replace function auth.uid()
returns uuid
language sql
stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- ---------------------------------------------------------------------
-- Roles
--
-- `authenticated` es el rol con el que el servidor atiende las peticiones
-- de la plantilla: está sujeto a la RLS y NO puede modificar ni borrar un
-- fichaje. El servidor solo abandona ese rol para las tareas de
-- administración (altas, copias), y eso queda en el registro de accesos.
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- El rol de la plantilla NO puede leer los hashes de contraseña.
revoke all on auth.users from anon, authenticated;
grant select, insert, update on auth.users to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;

-- ---------------------------------------------------------------------
-- Sesiones
--
-- En servidor, no en el navegador: cerrar la sesión de un dispositivo
-- robado tiene que surtir efecto de verdad, y con un JWT autocontenido no
-- se puede revocar hasta que caduca.
-- ---------------------------------------------------------------------
create table if not exists auth.sessions (
  -- Se guarda el HASH del testigo, no el testigo. Quien consiga leer esta
  -- tabla no obtiene con ello ninguna sesión utilizable.
  token_hash   text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent   text,
  ip           inet
);

create index if not exists sessions_user_idx on auth.sessions (user_id);
create index if not exists sessions_expiry_idx on auth.sessions (expires_at);

revoke all on auth.sessions from anon, authenticated;
grant select, insert, update, delete on auth.sessions to service_role;
