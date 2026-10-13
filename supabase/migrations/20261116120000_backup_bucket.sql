-- Week 6 private backup bucket.
--
-- Additive. Safe to run once on a database that already has weeks 1–5.
-- Do not edit or re-run those files.
--
-- Supabase's free plan has no automatic backups. A weekly GitHub Action runs
-- pg_dump and uploads the encrypted file here. The bucket is private. There
-- is no policy for anon or authenticated, so a signed-in person cannot list
-- or download a dump. The Action uses the secret key, which bypasses row
-- level security.
--
-- Do not also create a bucket named backups in the Storage screen. If you
-- already did, delete that bucket first or this script stops on the
-- duplicate name.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'backups',
  'backups',
  false,
  52428800,
  array['application/octet-stream']
);
