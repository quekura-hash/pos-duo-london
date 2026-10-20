-- LonDuo POS · migración 0002 · almacén de actualizaciones de la app de Windows
-- Crea el bucket PÚBLICO `actualizaciones` (solo lectura para las cajas: el instalador y su archivo de versión no contienen datos del negocio).
-- Subir o borrar archivos lo hace el propietario desde el panel de Supabase (Storage) o un supervisor autenticado.
-- Si el bucket ya existe (lo creó a mano en el panel), esta migración lo deja con la configuración correcta.
-- IMPORTANTE: el instalador pesa ~105 MB. En Supabase: Storage → Settings → «Upload file size limit» debe ser de al menos 200 MB.

insert into storage.buckets (id, name, public, file_size_limit)
values ('actualizaciones', 'actualizaciones', true, 314572800)
on conflict (id) do update set public = true, file_size_limit = 314572800;

-- Solo un supervisor activo puede subir, reemplazar o borrar archivos desde la app (el acceso público es solo de lectura por URL).
create policy actualizaciones_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'actualizaciones' and pos.es_supervisor());
create policy actualizaciones_reemplazar on storage.objects for update to authenticated
  using (bucket_id = 'actualizaciones' and pos.es_supervisor()) with check (bucket_id = 'actualizaciones' and pos.es_supervisor());
create policy actualizaciones_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'actualizaciones' and pos.es_supervisor());
