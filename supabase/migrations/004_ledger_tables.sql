-- NyoFinance Phase 2 — Migration 004
-- Ledger tables: accounts, categories, transactions (minor units, append-only).
--
-- Prinsip:
--   * Uang disimpan sebagai BIGINT minor units (untuk IDR: 1 = Rp1).
--     TIDAK PERNAH memakai float/double untuk uang.
--   * Batas aman: 0..9007199254740991 (Number.MAX_SAFE_INTEGER) agar aman
--     di JS/JSON. Transaksi amount > 0.
--   * Transfer = satu baris dengan source+dest (atomik, wealth-neutral).
--     Saldo = opening + income - expense + transfer_in - transfer_out.
--   * Riwayat append-only: tidak ada DELETE via API; pembatalan = status.
--
-- Urutan: 001_core -> 002_invites -> 003_rls -> 004_ledger_tables -> 005_ledger_rpcs
-- Terapkan setelah 001-003. Idempoten (IF NOT EXISTS / DROP IF EXISTS).

-- ============================================================
-- accounts: milik keluarga, opening balance immutable (lihat trigger).
-- ============================================================
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  opening_balance_minor bigint not null default 0
    check (opening_balance_minor >= 0 and opening_balance_minor <= 9007199254740991),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_accounts_family
  on public.accounts (family_id);
-- Nama akun unik per keluarga (cegah duplikat "Dompet" ganda).
create unique index if not exists uq_accounts_family_name
  on public.accounts (family_id, name);

drop trigger if exists trg_accounts_updated_at on public.accounts;
create trigger trg_accounts_updated_at
  before update on public.accounts
  for each row execute function public.touch_updated_at();

-- opening_balance + name.trim? Nama dirapikan di RPC; trigger hanya kunci opening.
create or replace function public.lock_account_opening()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.family_id is distinct from old.family_id then
    raise exception 'account family is immutable' using errcode = '42501';
  end if;
  if new.opening_balance_minor is distinct from old.opening_balance_minor then
    raise exception 'opening balance is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_account_opening on public.accounts;
create trigger trg_lock_account_opening
  before update on public.accounts
  for each row execute function public.lock_account_opening();

-- ============================================================
-- categories: milik keluarga, kind income|expense, kind immutable.
-- ============================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  kind text not null check (kind in ('income', 'expense')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_categories_family
  on public.categories (family_id);
create unique index if not exists uq_categories_family_name
  on public.categories (family_id, name);

create or replace function public.lock_category_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.family_id is distinct from old.family_id
    or new.kind is distinct from old.kind then
    raise exception 'category identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_category on public.categories;
create trigger trg_lock_category
  before update on public.categories
  for each row execute function public.lock_category_identity();

-- ============================================================
-- transactions: satu baris per kejadian. Transfer = source+dest.
-- ============================================================
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  amount_minor bigint not null
    check (amount_minor >= 1 and amount_minor <= 9007199254740991),
  -- income/expense: account_id + category_id terisi, source/dest NULL.
  account_id uuid references public.accounts (id) on delete restrict,
  category_id uuid references public.categories (id) on delete restrict,
  -- transfer: source+dest terisi, account/category NULL.
  source_account_id uuid references public.accounts (id) on delete restrict,
  dest_account_id uuid references public.accounts (id) on delete restrict,
  note text check (note is null or char_length(note) <= 500),
  occurred_at date not null default CURRENT_DATE,
  status text not null default 'posted' check (status in ('posted', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 80),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint chk_tx_cancel_consistent check (
    (status = 'posted' and cancelled_at is null and cancelled_by is null) or
    (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null)
  ),
  constraint chk_tx_shape_income_expense check (
    (kind in ('income', 'expense') and account_id is not null
      and category_id is not null
      and source_account_id is null and dest_account_id is null)
    or
    (kind = 'transfer' and account_id is null
      and category_id is null
      and source_account_id is not null and dest_account_id is not null
      and source_account_id <> dest_account_id)
  ),
  constraint chk_tx_occurred_range check (
    occurred_at >= date '2000-01-01' and occurred_at <= CURRENT_DATE + 365
  )
);

-- Idempotency: satu kunci hanya sekali per keluarga (mencegah double-submit
-- termasuk balapan konkurensi: salah satu gagal unique_violation).
create unique index if not exists uq_tx_family_idempotency
  on public.transactions (family_id, idempotency_key);

create index if not exists idx_tx_family_occurred
  on public.transactions (family_id, occurred_at desc, created_at desc);
create index if not exists idx_tx_family_account
  on public.transactions (family_id, account_id)
  where account_id is not null;
create index if not exists idx_tx_family_source
  on public.transactions (family_id, source_account_id)
  where source_account_id is not null;
create index if not exists idx_tx_family_dest
  on public.transactions (family_id, dest_account_id)
  where dest_account_id is not null;
create index if not exists idx_tx_family_status
  on public.transactions (family_id, status);

-- Trigger: transaksi append-only. UPDATE hanya boleh posted -> cancelled
-- (kolom cancelled_at/by diisi RPC). Semua kolom keuangan immutable.
-- DELETE selalu ditolak di level trigger (lapis kedua selain RLS delete-none;
-- melindungi dari operasi langsung sebagai pemilik tabel di sesi lokal).
create or replace function public.lock_transaction_row()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'transactions cannot be deleted' using errcode = '42501';
  end if;
  -- Hanya transisi posted -> cancelled yang diizinkan.
  if old.status = 'cancelled' then
    raise exception 'cancelled transaction is final' using errcode = '23505';
  end if;
  if not (old.status = 'posted' and new.status = 'cancelled') then
    raise exception 'transactions are immutable except cancellation' using errcode = '42501';
  end if;
  if new.family_id is distinct from old.family_id
    or new.kind is distinct from old.kind
    or new.amount_minor is distinct from old.amount_minor
    or new.account_id is distinct from old.account_id
    or new.category_id is distinct from old.category_id
    or new.source_account_id is distinct from old.source_account_id
    or new.dest_account_id is distinct from old.dest_account_id
    or new.note is distinct from old.note
    or new.occurred_at is distinct from old.occurred_at
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_by is distinct from old.created_by
  then
    raise exception 'transaction fields are immutable' using errcode = '42501';
  end if;
  if new.cancelled_at is null or new.cancelled_by is null then
    raise exception 'cancellation must record actor and time' using errcode = '22001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_transaction on public.transactions;
create trigger trg_lock_transaction
  before update or delete on public.transactions
  for each row execute function public.lock_transaction_row();
