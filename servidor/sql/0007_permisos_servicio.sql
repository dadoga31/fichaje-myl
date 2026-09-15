-- =====================================================================
--  FICHAJE MyL — Permisos del rol de servicio
--
--  `service_role` tiene `bypassrls`, pero eso solo lo exime de las
--  POLÍTICAS; sigue necesitando permiso sobre la tabla. Y es correcto que
--  así sea: son dos mecanismos distintos y conviene no confundirlos.
--
--  Se le concede lo mínimo para lo único que hace en el camino del acceso:
--  comprobar si el perfil de quien inicia sesión existe y está de alta.
--  Ni un permiso más; todo lo demás pasa por `authenticated` y por la RLS.
-- =====================================================================

grant select on public.profiles to service_role;
grant select on public.companies to service_role;

-- Las altas y las copias las ejecuta el administrador de PostgreSQL desde
-- el propio equipo, no este rol: no se le da escritura sobre el libro.
revoke insert, update, delete on public.time_entries from service_role;
revoke insert, update, delete on public.time_entry_audits from service_role;
