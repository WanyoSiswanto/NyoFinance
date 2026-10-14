-- Verifikasi kebijakan Fase 1 (dijalankan manual terhadap DB lokal).
-- Prasyarat: migrasi 001–003 sudah diterapkan, dijalankan sebagai postgres.
-- Skrip ini memakai tabel sementara + fungsi bantu untuk mensimulasikan
-- dua keluarga dan memastikan isolasi tanpa server Supabase.
--
-- Cara pakai:
--   createdb nyofinance_verify
--   psql "dbname=nyofinance_verify" -f supabase/migrations/001_core.sql
--   psql "dbname=nyofinance_verify" -f supabase/migrations/002_invites.sql
--   psql "dbname=nyofinance_verify" -f supabase/migrations/003_rls.sql
--   psql "dbname=nyofinance_verify" -f tests/db/verify_policies.sql
--
-- Catatan: skrip mengasumsikan skema `auth` ada (seperti di Supabase).
-- Untuk Postgres polos, skema auth dibuat minimal di bawah.

-- Catatan: migrasi 001 sudah membuat stub auth minimal; blok ini idempoten.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb
);

-- Baris-baris RLS dilewati pemilik tabel; verifikasi logika inti dilakukan
-- sebagai operasi biasa (trigger + constraint + unique index).
do $$
declare
  u_owner_a uuid := gen_random_uuid();
  u_member_a uuid := gen_random_uuid();
  u_owner_b uuid := gen_random_uuid();
  fam_a uuid;
  fam_b uuid;
  h text := encode(decode(repeat('ab', 32), 'hex'), 'hex'); -- 64 hex valid
  h2 text := encode(decode(repeat('cd', 32), 'hex'), 'hex');
begin
  insert into auth.users (id) values (u_owner_a), (u_member_a), (u_owner_b);

  -- Simulasi create_family untuk dua keluarga (tanpa auth.uid: insert langsung
  -- sebagai pemilik DB untuk menyiapkan data uji).
  insert into public.families (id, name, created_by)
    values (gen_random_uuid(), 'Keluarga A', u_owner_a) returning id into fam_a;
  insert into public.families (id, name, created_by)
    values (gen_random_uuid(), 'Keluarga B', u_owner_b) returning id into fam_b;
  insert into public.family_members (family_id, user_id, role)
    values (fam_a, u_owner_a, 'owner'), (fam_b, u_owner_b, 'owner');
  insert into public.family_invitations (family_id, created_by, token_hash, expires_at)
    values (fam_a, u_owner_a, h, now() + interval '1 hour');

  -- 1. Hash unik parsial: hash aktif yang sama ditolak.
  begin
    insert into public.family_invitations (family_id, created_by, token_hash, expires_at)
      values (fam_a, u_owner_a, h, now() + interval '1 hour');
    raise exception 'FAIL: duplikat hash aktif diizinkan';
  exception when unique_violation then
    raise notice 'PASS: duplikat hash aktif ditolak';
  end;

  -- 2. Satu pengguna aktif = satu keluarga.
  begin
    insert into public.family_members (family_id, user_id, role)
      values (fam_b, u_owner_a, 'member');
    raise exception 'FAIL: pengguna bisa aktif di 2 keluarga';
  exception when unique_violation then
    raise notice 'PASS: satu keluarga aktif per pengguna ditegakkan';
  end;

  -- 3. lock_membership_identity: role tidak bisa diubah via UPDATE.
  insert into public.family_members (family_id, user_id, role, status)
    values (fam_a, u_member_a, 'member', 'active');
  begin
    update public.family_members set role = 'owner'
      where family_id = fam_a and user_id = u_member_a;
    raise exception 'FAIL: promosi diri via UPDATE diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: promosi diri via UPDATE diizinkan' then raise; end if;
    raise notice 'PASS: promosi diri via UPDATE ditolak (%)', sqlerrm;
  end;

  -- 4. Undangan kedaluwarsa tidak dianggap aktif oleh filter RPC
  --    (expires_at > created_at tetap dipenuhi: created 2 jam lalu,
  --    kedaluwarsa 1 jam lalu).
  insert into public.family_invitations (family_id, created_by, token_hash, expires_at, created_at)
    values (fam_a, u_owner_a, h2, now() - interval '1 hour', now() - interval '2 hours');
  if exists (
    select 1 from public.family_invitations
    where token_hash = h2 and used_at is null and revoked_at is null and expires_at > now()
  ) then
    raise exception 'FAIL: undangan kedaluwarsa dianggap aktif';
  else
    raise notice 'PASS: undangan kedaluwarsa tidak dianggap aktif';
  end if;

  -- 5. Hash aktif bersifat GLOBAL: keluarga B tidak boleh memakai ulang
  --    hash aktif milik keluarga A (mencegah ambiguitas tujuan accept).
  begin
    insert into public.family_invitations (family_id, created_by, token_hash, expires_at)
      values (fam_b, u_owner_b, h, now() + interval '1 hour');
    raise exception 'FAIL: hash aktif dipakai ulang lintas keluarga';
  exception when unique_violation then
    raise notice 'PASS: hash aktif lintas keluarga ditolak';
  end;

  -- 6. Trigger juga menolak perubahan family_id/user_id (bukan hanya role).
  begin
    update public.family_members set family_id = fam_b
      where family_id = fam_a and user_id = u_member_a;
    raise exception 'FAIL: pindah keluarga via UPDATE diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: pindah keluarga via UPDATE diizinkan' then raise; end if;
    raise notice 'PASS: pindah keluarga via UPDATE ditolak (%)', sqlerrm;
  end;

  raise notice 'Semua pemeriksaan verify_policies selesai.';
end $$;
