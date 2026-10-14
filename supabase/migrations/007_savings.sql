-- NyoFinance Phase 5 — Migration 007
-- Tujuan tabungan (savings goals) + kontribusi alokasi per keluarga.
--
-- Prinsip:
--   * Kontribusi adalah ALOKASI, bukan transaksi ledger baru: tidak menambah
--     income, tidak menambah total kekayaan, tidak muncul di laporan
--     income/expense. Saldo akun tetap diturunkan otoritatif dari ledger
--     Fase 2; tidak ada sistem saldo kedua.
--   * Uang = BIGINT minor units 1..9007199254740991; TIDAK PERNAH float.
--     Alokasi per goal diturunkan: sum(posted contributions).
--   * Riwayat dipertahankan: kontribusi append-only (UPDATE hanya
--     posted -> cancelled, DELETE ditolak); goal completed/archived
--     dipertahankan, tidak dihapus.
--   * Tulis lewat RPC SECURITY DEFINER; baca langsung untuk anggota.
--   * family_id tidak pernah dipercaya dari klien untuk kontribusi:
--     contribute_to_goal menurunkan family dari goal (server-side).
--
-- Urutan: setelah 006_budgets.sql. Idempoten (IF NOT EXISTS / DROP IF EXISTS).

-- ============================================================
-- savings_goals: satu baris per tujuan tabungan keluarga.
-- ============================================================
create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  target_minor bigint not null
    check (target_minor >= 1 and target_minor <= 9007199254740991),
  target_date date check (
    target_date is null
    or (target_date >= date '2000-01-01' and target_date <= date '2100-12-31')
  ),
  status text not null default 'active'
    check (status in ('active', 'completed', 'archived')),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Nama tujuan unik per keluarga (cegah duplikat "Dana darurat" ganda).
create unique index if not exists uq_goals_family_name
  on public.savings_goals (family_id, name);
create index if not exists idx_goals_family
  on public.savings_goals (family_id);
create index if not exists idx_goals_family_status
  on public.savings_goals (family_id, status);

drop trigger if exists trg_goals_updated_at on public.savings_goals;
create trigger trg_goals_updated_at
  before update on public.savings_goals
  for each row execute function public.touch_updated_at();

-- Trigger: kunci family_id; kunci transisi status (maju saja);
-- kunci field keuangan setelah selesai/diarsipkan (riwayat dipertahankan).
create or replace function public.enforce_goal_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' then
    return new;
  end if;
  -- family tidak boleh pindah.
  if new.family_id is distinct from old.family_id then
    raise exception 'goal family is immutable' using errcode = '42501';
  end if;
  -- Transisi status hanya maju: active -> completed|archived,
  -- completed -> archived. Tidak boleh kembali ke active.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'active' and new.status in ('completed', 'archived'))
      or (old.status = 'completed' and new.status = 'archived')
    ) then
      raise exception 'invalid goal status transition' using errcode = '42501';
    end if;
    return new;
  end if;
  -- Setelah completed/archived, hanya perubahan status yang diizinkan
  -- (cabang di atas sudah return); edit field lain ditolak.
  if old.status <> 'active' then
    raise exception 'finished goal is immutable except status' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_goal on public.savings_goals;
create trigger trg_enforce_goal
  before update on public.savings_goals
  for each row execute function public.enforce_goal_rules();

-- ============================================================
-- goal_contributions: alokasi per goal, append-only seperti transaksi.
-- ============================================================
create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  goal_id uuid not null references public.savings_goals (id) on delete restrict,
  amount_minor bigint not null
    check (amount_minor >= 1 and amount_minor <= 9007199254740991),
  note text check (note is null or char_length(note) <= 500),
  occurred_at date not null default CURRENT_DATE,
  status text not null default 'posted' check (status in ('posted', 'cancelled')),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 80),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint chk_contrib_cancel_consistent check (
    (status = 'posted' and cancelled_at is null and cancelled_by is null) or
    (status = 'cancelled' and cancelled_at is not null and cancelled_by is not null)
  ),
  constraint chk_contrib_occurred_range check (
    occurred_at >= date '2000-01-01' and occurred_at <= CURRENT_DATE + 365
  )
);

-- Idempotency per keluarga (mencegah double-submit kontribusi).
create unique index if not exists uq_contrib_family_idempotency
  on public.goal_contributions (family_id, idempotency_key);
create index if not exists idx_contrib_goal_occurred
  on public.goal_contributions (goal_id, occurred_at desc, created_at desc);
create index if not exists idx_contrib_family_status
  on public.goal_contributions (family_id, status);
create index if not exists idx_contrib_family_goal
  on public.goal_contributions (family_id, goal_id);

-- Trigger: kontribusi milik goal yang sama keluarganya (cross-family ditolak
-- di batas DB, bukan hanya di RPC).
create or replace function public.enforce_contribution_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_goal_family uuid;
begin
  select g.family_id into v_goal_family
  from public.savings_goals g where g.id = new.goal_id;
  if not found then
    raise exception 'goal not found' using errcode = '02000';
  end if;
  if v_goal_family is distinct from new.family_id then
    raise exception 'goal family mismatch' using errcode = '22001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_contribution on public.goal_contributions;
create trigger trg_enforce_contribution
  before insert on public.goal_contributions
  for each row execute function public.enforce_contribution_rules();

-- Trigger: append-only seperti transaksi. UPDATE hanya posted -> cancelled;
-- DELETE selalu ditolak. Kolom keuangan immutable.
create or replace function public.lock_goal_contribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'contributions cannot be deleted' using errcode = '42501';
  end if;
  if old.status = 'cancelled' then
    raise exception 'cancelled contribution is final' using errcode = '23505';
  end if;
  if not (old.status = 'posted' and new.status = 'cancelled') then
    raise exception 'contributions are immutable except cancellation' using errcode = '42501';
  end if;
  if new.family_id is distinct from old.family_id
    or new.goal_id is distinct from old.goal_id
    or new.amount_minor is distinct from old.amount_minor
    or new.note is distinct from old.note
    or new.occurred_at is distinct from old.occurred_at
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_by is distinct from old.created_by
  then
    raise exception 'contribution fields are immutable' using errcode = '42501';
  end if;
  if new.cancelled_at is null or new.cancelled_by is null then
    raise exception 'cancellation must record actor and time' using errcode = '22001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_lock_contribution on public.goal_contributions;
create trigger trg_lock_contribution
  before update or delete on public.goal_contributions
  for each row execute function public.lock_goal_contribution();

-- ============================================================
-- RLS: baca anggota, tulis hanya via RPC.
-- ============================================================
alter table public.savings_goals enable row level security;

drop policy if exists goals_select_member on public.savings_goals;
create policy goals_select_member on public.savings_goals
  for select to authenticated using (public.is_family_member(family_id));

drop policy if exists goals_insert_none on public.savings_goals;
create policy goals_insert_none on public.savings_goals
  for insert to authenticated with check (false);

drop policy if exists goals_update_member on public.savings_goals;
create policy goals_update_member on public.savings_goals
  for update to authenticated
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

drop policy if exists goals_delete_none on public.savings_goals;
create policy goals_delete_none on public.savings_goals
  for delete to authenticated using (false);

alter table public.goal_contributions enable row level security;

drop policy if exists contrib_select_member on public.goal_contributions;
create policy contrib_select_member on public.goal_contributions
  for select to authenticated using (public.is_family_member(family_id));

drop policy if exists contrib_insert_none on public.goal_contributions;
create policy contrib_insert_none on public.goal_contributions
  for insert to authenticated with check (false);

drop policy if exists contrib_update_member on public.goal_contributions;
create policy contrib_update_member on public.goal_contributions
  for update to authenticated
  using (public.is_family_member(family_id))
  with check (public.is_family_member(family_id));

drop policy if exists contrib_delete_none on public.goal_contributions;
create policy contrib_delete_none on public.goal_contributions
  for delete to authenticated using (false);

-- ============================================================
-- RPC: buat tujuan tabungan.
-- ============================================================
create or replace function public.create_goal(
  p_family_id uuid,
  p_name text,
  p_description text default null,
  p_target_minor bigint default null,
  p_target_date date default null
)
returns public.savings_goals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_desc text;
  v_g public.savings_goals%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_family_member(p_family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'invalid goal name' using errcode = '22001';
  end if;
  v_desc := nullif(btrim(coalesce(p_description, '')), '');
  if v_desc is not null and char_length(v_desc) > 500 then
    raise exception 'invalid goal description' using errcode = '22001';
  end if;
  if p_target_minor is null or p_target_minor < 1
    or p_target_minor > 9007199254740991 then
    raise exception 'invalid goal target' using errcode = '22001';
  end if;
  if p_target_date is not null
    and (p_target_date < date '2000-01-01' or p_target_date > date '2100-12-31') then
    raise exception 'invalid goal target date' using errcode = '22001';
  end if;

  insert into public.savings_goals
    (family_id, name, description, target_minor, target_date, created_by)
  values
    (p_family_id, v_name, v_desc, p_target_minor, p_target_date, auth.uid())
  returning * into v_g;
  return v_g;
exception when unique_violation then
  raise exception 'duplicate goal' using errcode = '23505';
end;
$$;

-- ============================================================
-- RPC: ubah tujuan (hanya saat active; family dikunci trigger).
-- ============================================================
create or replace function public.update_goal(
  p_goal_id uuid,
  p_name text default null,
  p_description text default null,
  p_target_minor bigint default null,
  p_target_date date default null
)
returns public.savings_goals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_g public.savings_goals%rowtype;
  v_name text;
  v_desc text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_g from public.savings_goals g where g.id = p_goal_id;
  if not found then
    raise exception 'goal not found' using errcode = '02000';
  end if;
  if not public.is_family_member(v_g.family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if v_g.status <> 'active' then
    raise exception 'finished goal is immutable except status' using errcode = '42501';
  end if;

  v_name := v_g.name;
  if p_name is not null then
    v_name := btrim(p_name);
    if char_length(v_name) < 1 or char_length(v_name) > 80 then
      raise exception 'invalid goal name' using errcode = '22001';
    end if;
  end if;
  v_desc := v_g.description;
  if p_description is not null then
    v_desc := nullif(btrim(p_description), '');
    if v_desc is not null and char_length(v_desc) > 500 then
      raise exception 'invalid goal description' using errcode = '22001';
    end if;
  end if;
  if p_target_minor is not null then
    if p_target_minor < 1 or p_target_minor > 9007199254740991 then
      raise exception 'invalid goal target' using errcode = '22001';
    end if;
  else
    p_target_minor := v_g.target_minor;
  end if;
  if p_target_date is not null then
    if p_target_date < date '2000-01-01' or p_target_date > date '2100-12-31' then
      raise exception 'invalid goal target date' using errcode = '22001';
    end if;
  else
    -- NULL berarti "tidak diubah" di sini; pengosongan tanggal tidak
    -- didukung via update agar semantik eksplisit (buat ulang bila perlu).
    p_target_date := v_g.target_date;
  end if;

  update public.savings_goals g
  set name = v_name,
      description = v_desc,
      target_minor = p_target_minor,
      target_date = p_target_date
  where g.id = p_goal_id
  returning * into v_g;
  return v_g;
exception when unique_violation then
  raise exception 'duplicate goal' using errcode = '23505';
end;
$$;

-- ============================================================
-- RPC: selesaikan / arsipkan tujuan (transisi maju saja).
-- ============================================================
create or replace function public.complete_goal(p_goal_id uuid)
returns public.savings_goals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_g public.savings_goals%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.savings_goals g where g.id = p_goal_id;
  if not found then
    raise exception 'goal not found' using errcode = '02000';
  end if;
  if not public.is_family_member(v_g.family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if v_g.status <> 'active' then
    raise exception 'invalid goal status transition' using errcode = '42501';
  end if;
  update public.savings_goals g
  set status = 'completed'
  where g.id = p_goal_id
  returning * into v_g;
  return v_g;
end;
$$;

create or replace function public.archive_goal(p_goal_id uuid)
returns public.savings_goals
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_g public.savings_goals%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.savings_goals g where g.id = p_goal_id;
  if not found then
    raise exception 'goal not found' using errcode = '02000';
  end if;
  if not public.is_family_member(v_g.family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if v_g.status = 'archived' then
    raise exception 'invalid goal status transition' using errcode = '42501';
  end if;
  if v_g.status <> 'active' and v_g.status <> 'completed' then
    raise exception 'invalid goal status transition' using errcode = '42501';
  end if;
  update public.savings_goals g
  set status = 'archived'
  where g.id = p_goal_id
  returning * into v_g;
  return v_g;
end;
$$;

-- ============================================================
-- RPC: catat kontribusi alokasi (family diturunkan dari goal).
-- Reuse validate_ledger_input untuk amount/note/tanggal/idem.
-- ============================================================
create or replace function public.contribute_to_goal(
  p_goal_id uuid,
  p_amount_minor bigint,
  p_note text default null,
  p_occurred_at date default CURRENT_DATE,
  p_idempotency_key text default null
)
returns public.goal_contributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_goal public.savings_goals%rowtype;
  v_note text; v_occ date; v_idem text;
  v_c public.goal_contributions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_goal from public.savings_goals g where g.id = p_goal_id;
  if not found then
    raise exception 'goal not found' using errcode = '02000';
  end if;
  if not public.is_family_member(v_goal.family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if v_goal.status = 'archived' then
    raise exception 'goal is archived' using errcode = '42501';
  end if;
  select * into v_note, v_occ, v_idem
  from public.validate_ledger_input(p_amount_minor, p_note, p_occurred_at, p_idempotency_key);

  begin
    insert into public.goal_contributions
      (family_id, goal_id, amount_minor, note, occurred_at, idempotency_key, created_by)
    values
      (v_goal.family_id, p_goal_id, p_amount_minor, v_note, v_occ, v_idem, auth.uid())
    returning * into v_c;
  exception when unique_violation then
    -- Double-submit dengan kunci sama: kembalikan baris yang sudah ada.
    select * into v_c from public.goal_contributions c
    where c.family_id = v_goal.family_id and c.idempotency_key = v_idem;
    if not found then raise; end if;
  end;
  return v_c;
end;
$$;

-- ============================================================
-- RPC: batalkan kontribusi (posted -> cancelled, sekali saja).
-- ============================================================
create or replace function public.cancel_contribution(p_contribution_id uuid)
returns public.goal_contributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_c public.goal_contributions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_c from public.goal_contributions c
  where c.id = p_contribution_id for update;
  if not found then
    raise exception 'contribution not found' using errcode = '02000';
  end if;
  if not public.is_family_member(v_c.family_id) then
    raise exception 'not family member' using errcode = '42501';
  end if;
  if v_c.status = 'cancelled' then
    raise exception 'already cancelled' using errcode = '23505';
  end if;
  update public.goal_contributions c
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where c.id = p_contribution_id and c.status = 'posted'
  returning * into v_c;
  if not found then
    raise exception 'already cancelled' using errcode = '23505';
  end if;
  return v_c;
end;
$$;

-- ============================================================
-- RPC baca: status tujuan — target + terkumpul otoritatif.
--   allocated = sum(posted contributions goal itu).
--   remaining = target - allocated (boleh negatif = terlampaui).
-- ============================================================
create or replace function public.get_goal_status(p_family_id uuid)
returns table (
  goal_id uuid,
  goal_name text,
  target_minor bigint,
  allocated_minor bigint,
  remaining_minor bigint,
  status text,
  target_date date
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
    g.id,
    g.name,
    g.target_minor,
    s.allocated,
    g.target_minor - s.allocated,
    g.status,
    g.target_date
  from public.savings_goals g
  left join lateral (
    select coalesce(sum(c.amount_minor), 0) as allocated
    from public.goal_contributions c
    where c.goal_id = g.id
      and c.status = 'posted'
  ) s on true
  where g.family_id = p_family_id
  order by g.created_at asc, g.name asc;
end;
$$;

-- ============================================================
-- Grants: least-privilege (hanya objek baru; grant lama tidak diubah).
-- ============================================================
revoke all on table public.savings_goals from anon, authenticated;
grant select, update on public.savings_goals to authenticated;

revoke all on table public.goal_contributions from anon, authenticated;
grant select, update on public.goal_contributions to authenticated;
-- Tanpa INSERT/DELETE langsung: tulis hanya via RPC.

revoke all on function public.enforce_goal_rules() from public, anon, authenticated;
revoke all on function public.enforce_contribution_rules() from public, anon, authenticated;
revoke all on function public.lock_goal_contribution() from public, anon, authenticated;
revoke all on function public.create_goal(uuid, text, text, bigint, date) from public, anon, authenticated;
revoke all on function public.update_goal(uuid, text, text, bigint, date) from public, anon, authenticated;
revoke all on function public.complete_goal(uuid) from public, anon, authenticated;
revoke all on function public.archive_goal(uuid) from public, anon, authenticated;
revoke all on function public.contribute_to_goal(uuid, bigint, text, date, text) from public, anon, authenticated;
revoke all on function public.cancel_contribution(uuid) from public, anon, authenticated;
revoke all on function public.get_goal_status(uuid) from public, anon, authenticated;
grant execute on function public.enforce_goal_rules() to authenticated;
grant execute on function public.enforce_contribution_rules() to authenticated;
grant execute on function public.lock_goal_contribution() to authenticated;
grant execute on function public.create_goal(uuid, text, text, bigint, date) to authenticated;
grant execute on function public.update_goal(uuid, text, text, bigint, date) to authenticated;
grant execute on function public.complete_goal(uuid) to authenticated;
grant execute on function public.archive_goal(uuid) to authenticated;
grant execute on function public.contribute_to_goal(uuid, bigint, text, date, text) to authenticated;
grant execute on function public.cancel_contribution(uuid) to authenticated;
grant execute on function public.get_goal_status(uuid) to authenticated;

grant usage on schema public to authenticated;
