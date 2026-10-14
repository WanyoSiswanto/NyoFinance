-- NyoFinance Phase 2 — Migration 005
-- RLS + RPC atomik ledger + ringkasan.
--
-- Prinsip:
--   * Semua tulis lewat RPC SECURITY DEFINER (validasi di batas DB).
--   * Baca langsung diizinkan untuk anggota keluarga (SELECT via RLS).
--   * Saldo selalu diturunkan dari transaksi posted + opening (tidak ada
--     kolom saldo yang disimpan).
--   * Transfer mengunci kedua akun dengan urutan deterministik (anti-deadlock)
--     dan wealth-neutral (debit sumber, kredit tujuan, total tetap).
--   * Idempotency: (family_id, idempotency_key) unik; submit ulang dengan
--     kunci sama mengembalikan baris yang sudah ada (tidak ganda).
--
-- Urutan: setelah 004_ledger_tables.sql. Idempoten.

-- ============================================================
-- RLS: aktifkan + kebijakan.
-- ============================================================
alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;

-- ---- accounts ----
drop policy if exists accounts_select_member on public.accounts;
create policy accounts_select_member on public.accounts
  for select to authenticated using (public.is_family_member(family_id));

drop policy if exists accounts_insert_none on public.accounts;
create policy accounts_insert_none on public.accounts
  for insert to authenticated with check (false);

drop policy if exists accounts_update_member on public.accounts;
create policy accounts_update_member on public.accounts
  for update to authenticated
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

drop policy if exists accounts_delete_none on public.accounts;
create policy accounts_delete_none on public.accounts
  for delete to authenticated using (false);

-- ---- categories ----
drop policy if exists categories_select_member on public.categories;
create policy categories_select_member on public.categories
  for select to authenticated using (public.is_family_member(family_id));

drop policy if exists categories_insert_none on public.categories;
create policy categories_insert_none on public.categories
  for insert to authenticated with check (false);

drop policy if exists categories_update_member on public.categories;
create policy categories_update_member on public.categories
  for update to authenticated
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

drop policy if exists categories_delete_none on public.categories;
create policy categories_delete_none on public.categories
  for delete to authenticated using (false);

-- ---- transactions ----
drop policy if exists tx_select_member on public.transactions;
create policy tx_select_member on public.transactions
  for select to authenticated using (public.is_family_member(family_id));

drop policy if exists tx_insert_none on public.transactions;
create policy tx_insert_none on public.transactions
  for insert to authenticated with check (false);

drop policy if exists tx_update_member on public.transactions;
-- UPDATE hanya untuk pembatalan; trigger lock_transaction_row menegakkan
-- posted -> cancelled dan imutabilitas kolom lain.
create policy tx_update_member on public.transactions
  for update to authenticated
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

drop policy if exists tx_delete_none on public.transactions;
create policy tx_delete_none on public.transactions
  for delete to authenticated using (false);

-- ============================================================
-- RPC: buat akun.
-- ============================================================
create or replace function public.create_account(
  p_family_id uuid,
  p_name text,
  p_opening_balance_minor bigint default 0
)
returns public.accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_opening bigint := coalesce(p_opening_balance_minor, 0);
  v_acc public.accounts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'invalid account name' using errcode = '22001';
  end if;
  if v_opening < 0 or v_opening > 9007199254740991 then
    raise exception 'invalid opening balance' using errcode = '22001';
  end if;

  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
  values (p_family_id, v_name, v_opening, auth.uid())
  returning * into v_acc;
  return v_acc;
exception when unique_violation then
  raise exception 'duplicate account name' using errcode = '23505';
end;
$$;

-- ============================================================
-- RPC: buat kategori.
-- ============================================================
create or replace function public.create_category(
  p_family_id uuid,
  p_name text,
  p_kind text
)
returns public.categories
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_kind text := lower(btrim(coalesce(p_kind, '')));
  v_cat public.categories%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'invalid category name' using errcode = '22001';
  end if;
  if v_kind not in ('income', 'expense') then
    raise exception 'invalid category kind' using errcode = '22001';
  end if;

  insert into public.categories (family_id, name, kind, created_by)
  values (p_family_id, v_name, v_kind, auth.uid())
  returning * into v_cat;
  return v_cat;
exception when unique_violation then
  raise exception 'duplicate category name' using errcode = '23505';
end;
$$;

-- ============================================================
-- Helper internal: validasi amount/note/date/idempotency.
-- ============================================================
create or replace function public.validate_ledger_input(
  p_amount_minor bigint,
  p_note text,
  p_occurred_at date,
  p_idempotency_key text
)
returns table (note text, occurred date, idem text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_occ date := coalesce(p_occurred_at, CURRENT_DATE);
  v_idem text := btrim(coalesce(p_idempotency_key, ''));
begin
  if p_amount_minor is null or p_amount_minor < 1
    or p_amount_minor > 9007199254740991 then
    raise exception 'invalid amount' using errcode = '22001';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'invalid note' using errcode = '22001';
  end if;
  if v_occ < date '2000-01-01' or v_occ > CURRENT_DATE + 365 then
    raise exception 'invalid date' using errcode = '22001';
  end if;
  if char_length(v_idem) < 1 or char_length(v_idem) > 80
    or v_idem !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'invalid idempotency key' using errcode = '22001';
  end if;
  return query select v_note, v_occ, v_idem;
end;
$$;

-- ============================================================
-- RPC:.post income / expense (atomik, idempotent).
-- ============================================================
create or replace function public.post_income(
  p_family_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_amount_minor bigint,
  p_note text default null,
  p_occurred_at date default CURRENT_DATE,
  p_idempotency_key text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acc_family uuid;
  v_cat_family uuid;
  v_cat_kind text;
  v_note text; v_occ date; v_idem text;
  v_tx public.transactions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  select * into v_note, v_occ, v_idem
  from public.validate_ledger_input(p_amount_minor, p_note, p_occurred_at, p_idempotency_key);

  -- Kunci akun agar posting konkuren terserialisasi per akun.
  select a.family_id into v_acc_family
  from public.accounts a where a.id = p_account_id for update;
  if not found then
    raise exception 'account not found' using errcode = '02000';
  end if;
  if v_acc_family is distinct from p_family_id then
    raise exception 'account family mismatch' using errcode = '22001';
  end if;

  select c.family_id, c.kind into v_cat_family, v_cat_kind
  from public.categories c where c.id = p_category_id;
  if not found then
    raise exception 'category not found' using errcode = '02000';
  end if;
  if v_cat_family is distinct from p_family_id then
    raise exception 'category family mismatch' using errcode = '22001';
  end if;
  if v_cat_kind <> 'income' then
    raise exception 'category kind mismatch' using errcode = '22001';
  end if;

  begin
    insert into public.transactions
      (family_id, kind, amount_minor, account_id, category_id,
       note, occurred_at, idempotency_key, created_by)
    values
      (p_family_id, 'income', p_amount_minor, p_account_id, p_category_id,
       v_note, v_occ, v_idem, auth.uid())
    returning * into v_tx;
  exception when unique_violation then
    -- Double-submit dengan kunci sama: kembalikan baris yang sudah ada.
    select * into v_tx from public.transactions t
    where t.family_id = p_family_id and t.idempotency_key = v_idem;
    if not found then raise; end if;
  end;
  return v_tx;
end;
$$;

create or replace function public.post_expense(
  p_family_id uuid,
  p_account_id uuid,
  p_category_id uuid,
  p_amount_minor bigint,
  p_note text default null,
  p_occurred_at date default CURRENT_DATE,
  p_idempotency_key text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_acc_family uuid;
  v_cat_family uuid;
  v_cat_kind text;
  v_note text; v_occ date; v_idem text;
  v_tx public.transactions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  select * into v_note, v_occ, v_idem
  from public.validate_ledger_input(p_amount_minor, p_note, p_occurred_at, p_idempotency_key);

  select a.family_id into v_acc_family
  from public.accounts a where a.id = p_account_id for update;
  if not found then
    raise exception 'account not found' using errcode = '02000';
  end if;
  if v_acc_family is distinct from p_family_id then
    raise exception 'account family mismatch' using errcode = '22001';
  end if;

  select c.family_id, c.kind into v_cat_family, v_cat_kind
  from public.categories c where c.id = p_category_id;
  if not found then
    raise exception 'category not found' using errcode = '02000';
  end if;
  if v_cat_family is distinct from p_family_id then
    raise exception 'category family mismatch' using errcode = '22001';
  end if;
  if v_cat_kind <> 'expense' then
    raise exception 'category kind mismatch' using errcode = '22001';
  end if;

  begin
    insert into public.transactions
      (family_id, kind, amount_minor, account_id, category_id,
       note, occurred_at, idempotency_key, created_by)
    values
      (p_family_id, 'expense', p_amount_minor, p_account_id, p_category_id,
       v_note, v_occ, v_idem, auth.uid())
    returning * into v_tx;
  exception when unique_violation then
    select * into v_tx from public.transactions t
    where t.family_id = p_family_id and t.idempotency_key = v_idem;
    if not found then raise; end if;
  end;
  return v_tx;
end;
$$;

-- ============================================================
-- RPC: transfer antar akun keluarga (atomik, wealth-neutral).
-- ============================================================
create or replace function public.post_transfer(
  p_family_id uuid,
  p_source_account_id uuid,
  p_dest_account_id uuid,
  p_amount_minor bigint,
  p_note text default null,
  p_occurred_at date default CURRENT_DATE,
  p_idempotency_key text default null
)
returns public.transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_src_family uuid;
  v_dst_family uuid;
  v_note text; v_occ date; v_idem text;
  v_tx public.transactions%rowtype;
  v_first uuid; v_second uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if p_source_account_id = p_dest_account_id then
    raise exception 'same account transfer' using errcode = '22001';
  end if;
  select * into v_note, v_occ, v_idem
  from public.validate_ledger_input(p_amount_minor, p_note, p_occurred_at, p_idempotency_key);

  -- Kunci kedua akun dengan urutan deterministik (anti-deadlock).
  if p_source_account_id < p_dest_account_id then
    v_first := p_source_account_id; v_second := p_dest_account_id;
  else
    v_first := p_dest_account_id; v_second := p_source_account_id;
  end if;
  perform 1 from public.accounts a where a.id = v_first for update;
  perform 1 from public.accounts a where a.id = v_second for update;

  select a.family_id into v_src_family
  from public.accounts a where a.id = p_source_account_id;
  if not found then
    raise exception 'source account not found' using errcode = '02000';
  end if;
  select a.family_id into v_dst_family
  from public.accounts a where a.id = p_dest_account_id;
  if not found then
    raise exception 'dest account not found' using errcode = '02000';
  end if;
  if v_src_family is distinct from p_family_id
    or v_dst_family is distinct from p_family_id then
    raise exception 'account family mismatch' using errcode = '22001';
  end if;

  begin
    insert into public.transactions
      (family_id, kind, amount_minor, source_account_id, dest_account_id,
       note, occurred_at, idempotency_key, created_by)
    values
      (p_family_id, 'transfer', p_amount_minor, p_source_account_id,
       p_dest_account_id, v_note, v_occ, v_idem, auth.uid())
    returning * into v_tx;
  exception when unique_violation then
    select * into v_tx from public.transactions t
    where t.family_id = p_family_id and t.idempotency_key = v_idem;
    if not found then raise; end if;
  end;
  return v_tx;
end;
$$;

-- ============================================================
-- RPC: batalkan transaksi (posted -> cancelled, sekali saja).
-- Balapan dua pembatalan: hanya satu yang menang (conditional UPDATE).
-- ============================================================
create or replace function public.cancel_transaction(p_transaction_id uuid)
returns public.transactions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tx public.transactions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_tx from public.transactions t
  where t.id = p_transaction_id for update;
  if not found then
    raise exception 'transaction not found' using errcode = '02000';
  end if;
  if not public.is_family_member(v_tx.family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if v_tx.status = 'cancelled' then
    raise exception 'already cancelled' using errcode = '23505';
  end if;

  update public.transactions t
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where t.id = p_transaction_id and t.status = 'posted'
  returning * into v_tx;
  if not found then
    raise exception 'already cancelled' using errcode = '23505';
  end if;
  return v_tx;
end;
$$;

-- ============================================================
-- RPC baca: saldo per akun (otoritatif dari transaksi posted).
--   balance = opening + income - expense + transfer_in - transfer_out
-- ============================================================
create or replace function public.get_account_balances(p_family_id uuid)
returns table (
  account_id uuid,
  account_name text,
  opening_balance_minor bigint,
  balance_minor bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;

  return query
  select
    a.id,
    a.name,
    a.opening_balance_minor,
    a.opening_balance_minor
      + coalesce((
          select sum(t.amount_minor) from public.transactions t
          where t.family_id = a.family_id and t.kind = 'income'
            and t.account_id = a.id and t.status = 'posted'
        ), 0)
      - coalesce((
          select sum(t.amount_minor) from public.transactions t
          where t.family_id = a.family_id and t.kind = 'expense'
            and t.account_id = a.id and t.status = 'posted'
        ), 0)
      + coalesce((
          select sum(t.amount_minor) from public.transactions t
          where t.family_id = a.family_id and t.kind = 'transfer'
            and t.dest_account_id = a.id and t.status = 'posted'
        ), 0)
      - coalesce((
          select sum(t.amount_minor) from public.transactions t
          where t.family_id = a.family_id and t.kind = 'transfer'
            and t.source_account_id = a.id and t.status = 'posted'
        ), 0)
  from public.accounts a
  where a.family_id = p_family_id
  order by a.name asc;
end;
$$;

-- ============================================================
-- RPC baca: total keluarga = jumlah saldo semua akun.
-- ============================================================
create or replace function public.get_family_total(p_family_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_total bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;

  select sum(b.balance_minor) into v_total
  from public.get_account_balances(p_family_id) b;
  return coalesce(v_total, 0);
end;
$$;

-- ============================================================
-- RPC baca: ringkasan kas bulanan (posted saja, transfer dikecualikan
-- agar wealth-neutral: tidak dihitung sebagai income/expense).
-- ============================================================
create or replace function public.get_monthly_summary(
  p_family_id uuid,
  p_year int,
  p_month int
)
returns table (
  income_total_minor bigint,
  expense_total_minor bigint,
  net_minor bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date;
  v_end date;
  v_inc bigint;
  v_exp bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100
    or p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'invalid month' using errcode = '22001';
  end if;
  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month')::date;

  select coalesce(sum(t.amount_minor), 0) into v_inc
  from public.transactions t
  where t.family_id = p_family_id and t.kind = 'income'
    and t.status = 'posted'
    and t.occurred_at >= v_start and t.occurred_at < v_end;

  select coalesce(sum(t.amount_minor), 0) into v_exp
  from public.transactions t
  where t.family_id = p_family_id and t.kind = 'expense'
    and t.status = 'posted'
    and t.occurred_at >= v_start and t.occurred_at < v_end;

  return query select v_inc, v_exp, v_inc - v_exp;
end;
$$;

-- ============================================================
-- Grants: least-privilege.
-- ============================================================
revoke all on table public.accounts from anon, authenticated;
revoke all on table public.categories from anon, authenticated;
revoke all on table public.transactions from anon, authenticated;
grant select, update on public.accounts to authenticated;
grant select, update on public.categories to authenticated;
grant select, update on public.transactions to authenticated;
-- Tanpa INSERT/DELETE langsung: tulis hanya via RPC.

revoke all on all functions in schema public from public, anon, authenticated;
-- Fase 1 (di-grant ulang agar tetap berlaku setelah revoke-all).
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
-- Fase 2.
grant execute on function public.lock_account_opening() to authenticated;
grant execute on function public.lock_category_identity() to authenticated;
grant execute on function public.lock_transaction_row() to authenticated;
grant execute on function public.create_account(uuid, text, bigint) to authenticated;
grant execute on function public.create_category(uuid, text, text) to authenticated;
grant execute on function public.validate_ledger_input(bigint, text, date, text) to authenticated;
grant execute on function public.post_income(uuid, uuid, uuid, bigint, text, date, text) to authenticated;
grant execute on function public.post_expense(uuid, uuid, uuid, bigint, text, date, text) to authenticated;
grant execute on function public.post_transfer(uuid, uuid, uuid, bigint, text, date, text) to authenticated;
grant execute on function public.cancel_transaction(uuid) to authenticated;
grant execute on function public.get_account_balances(uuid) to authenticated;
grant execute on function public.get_family_total(uuid) to authenticated;
grant execute on function public.get_monthly_summary(uuid, int, int) to authenticated;

grant usage on schema public to authenticated;
