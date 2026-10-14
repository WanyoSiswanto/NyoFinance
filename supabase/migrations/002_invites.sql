-- NyoFinance Phase 1 — Migration 002
-- Tabel undangan keluarga: token acak, kedaluwarsa, sekali pakai, disimpan hashed.
--
-- Alur:
--   1. Owner membuat undangan -> server membuat token mentah acak (tidak dicatat log),
--      menyimpan SHA-256(token) ke kolom token_hash, menampilkan token mentah SEKALI.
--   2. Anggota kedua menempel token mentah -> server hashing -> RPC accept_family_invite().
--   3. RPC memvalidasi kedaluwarsa/pemakaian/pencabutan lalu memasukkan anggota atomik.
--
-- Terapkan setelah 001_core.sql, sebelum 003_rls.sql.

create table if not exists public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  created_by uuid not null references auth.users (id),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint chk_invite_expiry check (expires_at > created_at),
  constraint chk_invite_used_consistent check (
    (used_at is null and used_by is null) or
    (used_at is not null and used_by is not null)
  )
);

-- Satu hash aktif mencegah duplikat token global; hash boleh dipakai ulang
-- setelah undangan dipakai/dicabut (status dipindah, bukan dihapus
-- agar audit trail tetap ada). Catatan: predikat parsial tidak boleh memakai
-- now() (tidak immutable), jadi indeks mencakup (token_hash) + status lalu
-- keaktifan waktu (expires_at) dicek di RPC accept_family_invite.
-- Cakupan GLOBAL (bukan per-keluarga) disengaja: accept_family_invite mencari
-- hanya berdasarkan token_hash, jadi dua keluarga dengan hash sama akan
-- menimbulkan ambiguitas keluarga-tujuan. Indeks ini menutupnya.
create unique index if not exists uq_invite_token_hash_open
  on public.family_invitations (token_hash)
  where used_at is null and revoked_at is null;

create index if not exists idx_invites_family
  on public.family_invitations (family_id);
create index if not exists idx_invites_family_open
  on public.family_invitations (family_id)
  where used_at is null and revoked_at is null;
create index if not exists idx_invites_created_by
  on public.family_invitations (created_by);
