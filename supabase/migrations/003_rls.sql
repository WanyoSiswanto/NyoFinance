-- NyoFinance Phase 1 — Migration 003
-- RLS + fungsi privileged (create_family, invite RPC, accept RPC) + grants.
--
-- Prinsip:
--   * RLS aktif di semua tabel aplikasi.
--   * Kebijakan SELECT/INSERT/UPDATE/DELETE eksplisit, least-privilege.
--   * Hindari rekursi RLS: pengecekan keanggotaan dilakukan via fungsi
--     SECURITY DEFINER yang stabil (is_family_member / is_family_owner)
--     dengan search_path aman, lalu policy memanggil fungsi tersebut.
--   * Client TIDAK boleh insert langsung menjadi owner / join keluarga
--     sembarang — semua lewat RPC yang memvalidasi sisi server.
--
-- Urutan: 001_core.sql -> 002_invites.sql -> 003_rls.sql
-- Terapkan dengan role pemilik database (mis. postgres / supabase superuser
-- lokal). Untuk Supabase Cloud, jalankan via SQL editor / `supabase db push`.
--
-- Kompatibilitas Postgres polos: role `authenticated`/`anon` (bawaan Supabase)
-- dibuat jika belum ada agar migrasi bisa diuji di CI lokal. Di Supabase Cloud
-- blok ini menjadi no-op (DO ... EXCEPTION WHEN duplicate_object).

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end
$$;

-- ============================================================
-- Helper: keanggotaan (SECURITY DEFINER agar tidak rekursif).
-- ============================================================
create or replace function public.is_family_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = auth.uid()
      and fm.status = 'active'
  );
$$;

create or replace function public.is_family_owner(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = auth.uid()
      and fm.status = 'active'
      and fm.role = 'owner'
  );
$$;

create or replace function public.my_active_family_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select fm.family_id
  from public.family_members fm
  where fm.user_id = auth.uid()
    and fm.status = 'active'
  limit 1;
$$;

-- ============================================================
-- RPC: buat keluarga + jadikan pembuat sebagai owner (atomik).
-- Menegakkan "satu keluarga aktif per pengguna".
-- ============================================================
-- Sabuk pengaman konkurensi (TOCTOU): pemeriksaan "belum punya keluarga"
-- di bawah DIULANG setelah INSERT anggota — unique index parsial
-- uq_family_members_one_active_family adalah penegak final bila dua
-- permintaan bersamaan lolos pemeriksaan awal.
-- Penegak final: unique index parsial uq_family_members_one_active_family
-- (lihat 001_core.sql). Dua permintaan bersamaan yang lolos pemeriksaan
-- awal akan digagalkan salah satunya oleh unique_violation — pesan
-- "already in a family" dikembalikan ke pemanggil.
create or replace function public.create_family(
  p_name text,
  p_currency text default 'IDR'
)
returns public.families
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_currency text := upper(btrim(coalesce(p_currency, 'IDR')));
  v_family public.families%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'invalid family name' using errcode = '22001';
  end if;
  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid currency' using errcode = '22001';
  end if;
  if exists (
    select 1 from public.family_members fm
    where fm.user_id = auth.uid() and fm.status = 'active'
  ) then
    raise exception 'already in a family' using errcode = '23505';
  end if;

  insert into public.families (name, currency, created_by)
  values (v_name, v_currency, auth.uid())
  returning * into v_family;

  begin
    insert into public.family_members (family_id, user_id, role, status)
    values (v_family.id, auth.uid(), 'owner', 'active');
  exception when unique_violation then
    -- Balapan dengan permintaan lain (atau create/accept bersamaan):
    -- batalkan keluarga yatim yang baru dibuat lalu tolak.
    delete from public.families where id = v_family.id;
    raise exception 'already in a family' using errcode = '23505';
  end;

  return v_family;
end;
$$;

-- ============================================================
-- RPC: buat undangan (hanya owner). Token mentah dibuat di aplikasi,
-- di sini hanya menerima hash-nya. Mengembalikan baris undangan.
-- ============================================================
create or replace function public.create_family_invite(
  p_family_id uuid,
  p_token_hash text,
  p_expires_in_hours int default 72
)
returns public.family_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hours int := greatest(1, least(coalesce(p_expires_in_hours, 72), 168));
  v_invite public.family_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid token hash' using errcode = '22001';
  end if;
  if not public.is_family_owner(p_family_id) then
    raise exception 'not family owner' using errcode = '42501';
  end if;

  insert into public.family_invitations
    (family_id, created_by, token_hash, expires_at)
  values
    (p_family_id, auth.uid(), p_token_hash, now() + (v_hours || ' hours')::interval)
  returning * into v_invite;

  return v_invite;
end;
$$;

-- ============================================================
-- RPC: cabut undangan (hanya owner keluarga tsb).
-- ============================================================
create or replace function public.revoke_family_invite(p_invite_id uuid)
returns public.family_invitations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.family_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.family_invitations fi
  where fi.id = p_invite_id;

  if not found then
    raise exception 'invite not found' using errcode = '02000';
  end if;
  if not public.is_family_owner(v_invite.family_id) then
    raise exception 'not family owner' using errcode = '42501';
  end if;
  if v_invite.used_at is not null then
    raise exception 'invite already used' using errcode = '23505';
  end if;
  if v_invite.revoked_at is not null then
    return v_invite;
  end if;

  update public.family_invitations fi
  set revoked_at = now()
  where fi.id = p_invite_id
  returning * into v_invite;

  return v_invite;
end;
$$;

-- ============================================================
-- RPC: terima undangan (atomik, row-lock). Menolak:
--   kedaluwarsa / dipakai / dicabut / hash tidak dikenal /
--   pengguna sudah punya keluarga aktif.
-- ============================================================
create or replace function public.accept_family_invite(p_token_hash text)
returns public.family_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.family_invitations%rowtype;
  v_membership public.family_members%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid invite' using errcode = '22001';
  end if;
  if exists (
    select 1 from public.family_members fm
    where fm.user_id = auth.uid() and fm.status = 'active'
  ) then
    raise exception 'already in a family' using errcode = '23505';
  end if;

  select * into v_invite
  from public.family_invitations fi
  where fi.token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'invalid invite' using errcode = '02000';
  end if;
  if v_invite.revoked_at is not null
    or v_invite.used_at is not null
    or v_invite.expires_at <= now()
  then
    raise exception 'invite expired or already used' using errcode = '23505';
  end if;
  -- Sabuk pengaman: pemilik tidak perlu memakai undangan keluarganya sendiri.
  if public.is_family_member(v_invite.family_id) then
    raise exception 'already in a family' using errcode = '23505';
  end if;

  update public.family_invitations fi
  set used_at = now(), used_by = auth.uid()
  where fi.id = v_invite.id
    and fi.used_at is null
    and fi.revoked_at is null
    and fi.expires_at > now();

  if not found then
    raise exception 'invite expired or already used' using errcode = '23505';
  end if;

  insert into public.family_members (family_id, user_id, role, status)
  values (v_invite.family_id, auth.uid(), 'member', 'active')
  returning * into v_membership
  -- Catatan: bila pengguna berpacu antara create_family dan accept secara
  -- bersamaan, unique index satu-keluarga-aktif menggagalkan salah satunya
  -- dengan unique_violation. Biarkan error itu merambat apa adanya agar
  -- klien tidak salah mengira undangan telah terpakai padahal keanggotaan
  -- gagal dibuat (tidak ada rollback parsial yang disembunyikan).
  ;

  return v_membership;
end;
$$;

-- ============================================================
-- RLS: aktifkan + kebijakan eksplisit.
-- ============================================================
alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.family_invitations enable row level security;

-- ---- profiles ----
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

drop policy if exists profiles_insert_own on public.profiles;
-- Insert langsung dibatasi ke baris milik sendiri (trigger handle_new_user
-- berjalan sebagai definer, jadi pendaftaran tetap berfungsi walau tanpa ini;
-- policy ini hanya untuk update nama via aplikasi).
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_delete_none on public.profiles;
-- Tidak ada delete via API: baris ikut terhapus via ON DELETE CASCADE auth.
create policy profiles_delete_none on public.profiles
  for delete to authenticated using (false);

-- ---- families ----
drop policy if exists families_select_member on public.families;
create policy families_select_member on public.families
  for select to authenticated using (public.is_family_member(id));

drop policy if exists families_insert_none on public.families;
-- Pembuatan lewat RPC create_family (definer). Insert langsung ditolak agar
-- tidak ada yang bisa menyisipkan keluarga + klaim owner sembarangan.
create policy families_insert_none on public.families
  for insert to authenticated with check (false);

drop policy if exists families_update_owner on public.families;
create policy families_update_owner on public.families
  for update to authenticated
  using (public.is_family_owner(id))
  with check (public.is_family_owner(id));

drop policy if exists families_delete_none on public.families;
create policy families_delete_none on public.families
  for delete to authenticated using (false);

-- ---- family_members ----
drop policy if exists members_select_same_family on public.family_members;
create policy members_select_same_family on public.family_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_family_member(family_id)
  );

drop policy if exists members_insert_none on public.family_members;
-- Join hanya lewat RPC accept_family_invite. Insert langsung ditolak —
-- ini mencegah promosi diri menjadi owner / join keluarga sembarang.
create policy members_insert_none on public.family_members
  for insert to authenticated with check (false);

drop policy if exists members_update_leave on public.family_members;
-- Anggota hanya boleh menonaktifkan dirinya sendiri (keluar).
-- Perubahan role/status orang lain atau promosi diri ditolak:
-- role, family_id, user_id harus sama, dan status hanya boleh -> inactive.
create policy members_update_leave on public.family_members
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and status = 'inactive'
  );

drop policy if exists members_delete_none on public.family_members;
create policy members_delete_none on public.family_members
  for delete to authenticated using (false);

-- Trigger: kunci kolom role/family_id/user_id agar tidak bisa diubah
-- (UPDATE ... SET role='owner' akan ditolak walau lolos policy).
create or replace function public.lock_membership_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.family_id is distinct from old.family_id
    or new.user_id is distinct from old.user_id
    or new.role is distinct from old.role
  then
    raise exception 'membership identity is immutable' using errcode = '42501';
  end if;
  if old.status = 'inactive' and new.status = 'active' then
    raise exception 'reactivation not allowed' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_membership on public.family_members;
create trigger trg_lock_membership
  before update on public.family_members
  for each row execute function public.lock_membership_identity();

-- ---- family_invitations ----
-- NOTE: token_hash TIDAK PERNAH bisa dibaca via API — tidak ada policy SELECT
-- yang mengeksposnya. Owner melihat metadata undangan lewat fungsi di bawah
-- (tanpa token_hash).
drop policy if exists invites_no_select on public.family_invitations;
-- (Tidak membuat policy SELECT sama sekali = tolak semua baca langsung.)

drop policy if exists invites_insert_none on public.family_invitations;
create policy invites_insert_none on public.family_invitations
  for insert to authenticated with check (false);

drop policy if exists invites_update_none on public.family_invitations;
create policy invites_update_none on public.family_invitations
  for update to authenticated using (false);

drop policy if exists invites_delete_none on public.family_invitations;
create policy invites_delete_none on public.family_invitations
  for delete to authenticated using (false);

-- Owner melihat daftar undangan keluarganya TANPA token_hash.
create or replace function public.list_family_invites(p_family_id uuid)
returns table (
  id uuid,
  family_id uuid,
  created_by uuid,
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid,
  revoked_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select fi.id, fi.family_id, fi.created_by, fi.expires_at,
         fi.used_at, fi.used_by, fi.revoked_at, fi.created_at
  from public.family_invitations fi
  where fi.family_id = p_family_id
    and public.is_family_owner(p_family_id)
  order by fi.created_at desc;
$$;

-- ============================================================
-- Grants: least-privilege. Service role tidak dipakai di browser.
-- ============================================================
revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, update on public.families to authenticated;
grant select, update on public.family_members to authenticated;
-- family_invitations: tanpa grant langsung; akses hanya via RPC.

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.touch_updated_at() to authenticated;
grant execute on function public.handle_new_user() to authenticated;
grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.is_family_owner(uuid) to authenticated;
grant execute on function public.my_active_family_id() to authenticated;
grant execute on function public.create_family(text, text) to authenticated;
grant execute on function public.create_family_invite(uuid, text, int) to authenticated;
grant execute on function public.revoke_family_invite(uuid) to authenticated;
grant execute on function public.accept_family_invite(text) to authenticated;
grant execute on function public.list_family_invites(uuid) to authenticated;
grant execute on function public.lock_membership_identity() to authenticated;

-- Sequence/identity tidak dipakai eksplisit (semua PK uuid default), tetapi
-- berikan usage agar RPC definer tetap berjalan untuk role terbatas.
grant usage on schema public to authenticated;
