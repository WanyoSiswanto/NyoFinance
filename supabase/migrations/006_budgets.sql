-- NyoFinance Phase 3 — Migration 006
-- Anggaran bulanan per keluarga + kategori expense.
--
-- Prinsip:
--   * Satu anggaran = satu keluarga + satu kategori expense + satu bulan
--     (unik (family_id, category_id, month)).
--   * Batas (limit) disimpan sebagai BIGINT minor units; TIDAK PERNAH float.
--   * Actual (terpakai) SELALU diturunkan dari transaksi posted jenis
--     expense pada bulan itu; transfer + cancelled tidak dihitung.
--     Tidak ada kolom saldo/terpakai yang disimpan (tanpa balance system baru).
--   * Anggaran yang terlampaui TIDAK memblokir transaksi expense.
--   * Riwayat dipertahankan: tidak ada DELETE via API; edit hanya limit.
--   * Tulis lewat RPC SECURITY DEFINER; baca langsung untuk anggota.
--
-- Urutan: setelah 005_ledger_rpcs.sql. Idempoten (IF NOT EXISTS / DROP IF EXISTS).

-- ============================================================
-- budgets: month = tanggal hari pertama bulan (date_trunc month).
-- ============================================================
create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  month date not null,
  limit_minor bigint not null
    check (limit_minor >= 1 and limit_minor <= 9007199254740991),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_budget_month_first check (month = date_trunc('month', month)::date),
  constraint chk_budget_month_range check (
    month >= date '2000-01-01' and month <= date '2100-12-01'
  )
);

-- Satu anggaran per keluarga + kategori + bulan.
create unique index if not exists uq_budgets_family_category_month
  on public.budgets (family_id, category_id, month);
create index if not exists idx_budgets_family_month
  on public.budgets (family_id, month);

drop trigger if exists trg_budgets_updated_at on public.budgets;
create trigger trg_budgets_updated_at
  before update on public.budgets
  for each row execute function public.touch_updated_at();

-- Trigger: kunci identitas (family/category/month) + pastikan kategori
-- adalah expense milik keluarga yang sama. Berlaku untuk SEMUA jalur tulis
-- (RPC definer maupun UPDATE langsung anggota), sehingga kategori income
-- dan family-id campur ditolak di batas DB.
create or replace function public.enforce_budget_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cat_family uuid;
  v_cat_kind text;
begin
  if TG_OP = 'INSERT' then
    select c.family_id, c.kind into v_cat_family, v_cat_kind
    from public.categories c where c.id = new.category_id;
    if not found then
      raise exception 'category not found' using errcode = '02000';
    end if;
    if v_cat_family is distinct from new.family_id then
      raise exception 'category family mismatch' using errcode = '22001';
    end if;
    if v_cat_kind <> 'expense' then
      raise exception 'income category not allowed' using errcode = '22001';
    end if;
    return new;
  end if;
  -- UPDATE: hanya limit_minor yang boleh berubah (riwayat bulan/kategori
  -- dipertahankan; CHECK limit_minor menegakkan rentang).
  if new.family_id is distinct from old.family_id
    or new.category_id is distinct from old.category_id
    or new.month is distinct from old.month then
    raise exception 'budget identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_budget on public.budgets;
create trigger trg_enforce_budget
  before insert or update on public.budgets
  for each row execute function public.enforce_budget_rules();

-- ============================================================
-- RLS: baca anggota, tulis hanya via RPC.
-- ============================================================
alter table public.budgets enable row level security;

drop policy if exists budgets_select_member on public.budgets;
create policy budgets_select_member on public.budgets
  for select to authenticated using (public.is_family_member(family_id));

drop policy if exists budgets_insert_none on public.budgets;
create policy budgets_insert_none on public.budgets
  for insert to authenticated with check (false);

drop policy if exists budgets_update_member on public.budgets;
-- UPDATE langsung oleh anggota hanya bisa mengubah limit (trigger mengunci
-- identitas + CHECK menegakkan rentang); jalur resmi tetap via RPC.
create policy budgets_update_member on public.budgets
  for update to authenticated
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

drop policy if exists budgets_delete_none on public.budgets;
create policy budgets_delete_none on public.budgets
  for delete to authenticated using (false);

-- ============================================================
-- RPC: buat anggaran.
-- ============================================================
create or replace function public.create_budget(
  p_family_id uuid,
  p_category_id uuid,
  p_year int,
  p_month int,
  p_limit_minor bigint
)
returns public.budgets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_month date;
  v_cat_family uuid;
  v_cat_kind text;
  v_b public.budgets%rowtype;
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
  if p_limit_minor is null or p_limit_minor < 1
    or p_limit_minor > 9007199254740991 then
    raise exception 'invalid budget limit' using errcode = '22001';
  end if;
  v_month := make_date(p_year, p_month, 1);

  select c.family_id, c.kind into v_cat_family, v_cat_kind
  from public.categories c where c.id = p_category_id;
  if not found then
    raise exception 'category not found' using errcode = '02000';
  end if;
  if v_cat_family is distinct from p_family_id then
    raise exception 'category family mismatch' using errcode = '22001';
  end if;
  if v_cat_kind <> 'expense' then
    raise exception 'income category not allowed' using errcode = '22001';
  end if;

  insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
  values (p_family_id, p_category_id, v_month, p_limit_minor, auth.uid())
  returning * into v_b;
  return v_b;
exception when unique_violation then
  raise exception 'duplicate budget' using errcode = '23505';
end;
$$;

-- ============================================================
-- RPC: ubah batas anggaran (hanya limit; identitas dikunci trigger).
-- ============================================================
create or replace function public.update_budget_limit(
  p_budget_id uuid,
  p_limit_minor bigint
)
returns public.budgets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_b public.budgets%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_limit_minor is null or p_limit_minor < 1
    or p_limit_minor > 9007199254740991 then
    raise exception 'invalid budget limit' using errcode = '22001';
  end if;

  select * into v_b from public.budgets b where b.id = p_budget_id;
  if not found then
    raise exception 'budget not found' using errcode = '02000';
  end if;
  if not public.is_family_member(v_b.family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;

  update public.budgets b
  set limit_minor = p_limit_minor
  where b.id = p_budget_id
  returning * into v_b;
  return v_b;
end;
$$;

-- ============================================================
-- RPC baca: status anggaran sebulan — limit + terpakai otoritatif.
--   spent = jumlah posted expense kategori itu pada bulan itu
--   (transfer + cancelled + income + bulan lain dikecualikan).
--   remaining = limit - spent (boleh negatif = terlampaui).
-- ============================================================
create or replace function public.get_budget_status(
  p_family_id uuid,
  p_year int,
  p_month int
)
returns table (
  budget_id uuid,
  category_id uuid,
  category_name text,
  month date,
  limit_minor bigint,
  spent_minor bigint,
  remaining_minor bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_start date;
  v_end date;
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

  return query
  select
    b.id,
    b.category_id,
    c.name,
    b.month,
    b.limit_minor,
    s.spent,
    b.limit_minor - s.spent
  from public.budgets b
  join public.categories c on c.id = b.category_id
  left join lateral (
    select coalesce(sum(t.amount_minor), 0) as spent
    from public.transactions t
    where t.family_id = b.family_id
      and t.kind = 'expense'
      and t.status = 'posted'
      and t.category_id = b.category_id
      and t.occurred_at >= v_start
      and t.occurred_at < v_end
  ) s on true
  where b.family_id = p_family_id
    and b.month = v_start
  order by c.name asc;
end;
$$;

-- ============================================================
-- Grants: least-privilege (hanya objek baru; grant lama tidak diubah).
-- ============================================================
revoke all on table public.budgets from anon, authenticated;
grant select, update on public.budgets to authenticated;
-- Tanpa INSERT/DELETE langsung: tulis hanya via RPC.

revoke all on function public.enforce_budget_rules() from public, anon, authenticated;
revoke all on function public.create_budget(uuid, uuid, int, int, bigint) from public, anon, authenticated;
revoke all on function public.update_budget_limit(uuid, bigint) from public, anon, authenticated;
revoke all on function public.get_budget_status(uuid, int, int) from public, anon, authenticated;
grant execute on function public.enforce_budget_rules() to authenticated;
grant execute on function public.create_budget(uuid, uuid, int, int, bigint) to authenticated;
grant execute on function public.update_budget_limit(uuid, bigint) to authenticated;
grant execute on function public.get_budget_status(uuid, int, int) to authenticated;

grant usage on schema public to authenticated;
