-- NyoFinance Phase 1 — Migration 001
-- Tabel inti: profiles, families, family_members + trigger profil otomatis.
--
-- Uji lokal:
--   createdb nyofinance_dev   (sekali saja)
--   psql $DATABASE_URL -f supabase/migrations/001_core.sql
--   psql $DATABASE_URL -f supabase/migrations/002_invites.sql
--   psql $DATABASE_URL -f supabase/migrations/003_rls.sql
--   psql $DATABASE_URL -f tests/db/verify_policies.sql  (verifikasi, butuh role postgres)

-- Diperlukan untuk gen_random_uuid().
create extension if not exists "pgcrypto";

-- Skema auth milik Supabase Auth di cloud. Untuk Postgres polos / CI lokal,
-- buat skema + tabel auth.users minimal agar migrasi bisa diuji mandiri.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb
);

-- Catatan kompatibilitas Supabase Cloud (PENTING):
--   * Di Supabase Cloud, fungsi auth.uid()/auth.jwt() SUDAH ADA dan dimiliki
--     oleh peran supabase_auth_admin. JANGAN jalankan blok stub di bawah di
--     Cloud — blok ini HANYA untuk Postgres polos / CI lokal.
--   * Sebelum menerapkan ke Cloud: hapus/komentari blok "create or replace
--     function auth.uid/jwt" ATAU pastikan dijalankan oleh pemilik fungsi
--     aslinya. Menimpa fungsi auth bawaan dapat merusak RLS global.
--   * Jalankan migrasi di Cloud sebagai pemilik database (postgres) melalui
--     SQL Editor sesuai urutan 001 -> 002 -> 003.
--
-- Stub auth.uid()/auth.jwt() untuk Postgres polos / CI lokal SAJA.
-- Dilewati otomatis bila fungsi bawaan Supabase sudah ada.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create function auth.uid() returns uuid
    language sql stable
    as $fn$ select null::uuid $fn$;
  end if;
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'jwt'
  ) then
    create function auth.jwt() returns jsonb
    language sql stable
    as $fn$ select '{}'::jsonb $fn$;
  end if;
end
$$;

-- ============================================================
-- profiles: satu baris per pengguna auth. Dibuat otomatis via trigger.
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- families: workspace keluarga. Mata uang default IDR.
-- ============================================================
create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  currency text not null default 'IDR' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- family_members: keanggotaan. Satu pengguna aktif = satu keluarga (MVP).
-- ============================================================
create table if not exists public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  joined_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create index if not exists idx_family_members_user
  on public.family_members (user_id);
create index if not exists idx_family_members_user_active
  on public.family_members (user_id)
  where status = 'active';
create index if not exists idx_family_members_family
  on public.family_members (family_id);
create index if not exists idx_families_created_by
  on public.families (created_by);

-- Satu pengguna hanya boleh aktif di satu keluarga (MVP).
-- Baris inactive lama tetap diizinkan (riwayat keluar).
create unique index if not exists uq_family_members_one_active_family
  on public.family_members (user_id)
  where status = 'active';

-- Trigger updated_at generik.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_families_updated_at on public.families;
create trigger trg_families_updated_at
  before update on public.families
  for each row execute function public.touch_updated_at();

-- Profil dibuat otomatis saat pengguna mendaftar (auth.users insert).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', null)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
