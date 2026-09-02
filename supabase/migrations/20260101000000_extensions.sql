-- ASSUMED: exact UUID generation function used by the live project was not verified.
-- pgcrypto's gen_random_uuid() is the modern Supabase default for uuid PK columns.
create extension if not exists "pgcrypto";
