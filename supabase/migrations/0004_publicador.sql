-- LonDuo POS · migración 0004 · cuenta «publicador»: solo puede subir actualizaciones al almacén `actualizaciones`
-- Sirve para publicar versiones de la app de Windows automáticamente (sin dar acceso a ventas, inventario, usuarios ni configuración).
-- Ejecutar UNA vez, después de 0001, 0002 y 0003.

alter table pos.admins drop constraint if exists admins_rol_check;
alter table pos.admins add constraint admins_rol_check check (rol in ('supervisor', 'almacenista', 'caja', 'publicador'));

create or replace function pos.es_publicador() returns boolean
language sql stable security definer set search_path = pos, public as
$$ select exists (select 1 from pos.admins a where a.user_id = auth.uid() and a.activo and a.rol = 'publicador') $$;
grant execute on function pos.es_publicador() to authenticated;

-- Las políticas del almacén pasan de «solo supervisor» a «supervisor o publicador» (y solo en ese almacén).
drop policy if exists actualizaciones_subir on storage.objects;
drop policy if exists actualizaciones_reemplazar on storage.objects;
drop policy if exists actualizaciones_borrar on storage.objects;
drop policy if exists actualizaciones_listar on storage.objects;
create policy actualizaciones_listar on storage.objects for select to authenticated
  using (bucket_id = 'actualizaciones' and (pos.es_supervisor() or pos.es_publicador()));
create policy actualizaciones_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'actualizaciones' and (pos.es_supervisor() or pos.es_publicador()));
create policy actualizaciones_reemplazar on storage.objects for update to authenticated
  using (bucket_id = 'actualizaciones' and (pos.es_supervisor() or pos.es_publicador()))
  with check (bucket_id = 'actualizaciones' and (pos.es_supervisor() or pos.es_publicador()));
create policy actualizaciones_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'actualizaciones' and (pos.es_supervisor() or pos.es_publicador()));
