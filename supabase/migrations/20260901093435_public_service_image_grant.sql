-- `services` uses column-level anonymous SELECT grants. Adding image_path does
-- not inherit the earlier grant, so public service cards need this explicit
-- safe-column grant after the schema migration.
grant select (image_path) on public.services to anon;
