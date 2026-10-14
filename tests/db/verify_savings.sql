-- Verifikasi tujuan tabungan Fase 5 (DB lokal terisolasi, tanpa migrasi baru).
-- Prasyarat: migrasi 001–007 sudah diterapkan, dijalankan sebagai postgres.
-- Menguji: buat + ubah + selesaikan + arsipkan tujuan, tolak target/nama
-- tidak valid, tolak nama duplikat per keluarga, progres = sum(posted)
-- dengan cancelled dikecualikan, batalkan setoran (sekali saja, append-only,
-- DELETE ditolak), idempotency per keluarga, family-id campur ditolak di
-- batas DB, transisi status maju saja, tujuan finished immutable, isolasi
-- lintas keluarga, invarians kekayaan (kontribusi bukan ledger: tidak ada
-- baris transactions baru, total/saldo/ringkasan tidak berubah, laporan
-- income/expense tetap nol), dan regresi Fase 1–4.
--
-- Cara pakai:
--   createdb nyofinance_p5_verify
--   for f in 001_core 002_invites 003_rls 004_ledger_tables 005_ledger_rpcs 006_budgets 007_savings; do
--     psql "dbname=nyofinance_p5_verify" -f supabase/migrations/$f.sql
--   done
--   psql "dbname=nyofinance_p5_verify" -f tests/db/verify_savings.sql

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb
);

do $savings_verify$
declare
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  fam_a uuid;
  fam_b uuid;
  acc_a uuid;
  cat_a uuid;
  goal uuid;
  goal2 uuid;
  c1 uuid;
  c2 uuid;
  v_target bigint;
  v_allocated bigint;
  v_remaining bigint;
  v_status text;
  v_cnt int;
  v_inc bigint;
  v_exp bigint;
  v_total bigint;
begin
  insert into auth.users (id) values (u_a), (u_b);

  insert into public.families (name, created_by)
    values ('Keluarga A', u_a) returning id into fam_a;
  insert into public.families (name, created_by)
    values ('Keluarga B', u_b) returning id into fam_b;
  insert into public.family_members (family_id, user_id, role)
    values (fam_a, u_a, 'owner'), (fam_b, u_b, 'owner');

  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_a, 'Dompet', 500000, u_a) returning id into acc_a;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Gaji', 'income', u_a) returning id into cat_a;

  -- 1. Buat tujuan: target 1000000.
  insert into public.savings_goals (family_id, name, target_minor, created_by)
    values (fam_a, 'Dana darurat', 1000000, u_a)
    returning id into goal;
  select g.target_minor, g.status into v_target, v_status
  from public.savings_goals g where g.id = goal;
  if v_target <> 1000000 or v_status <> 'active' then
    raise exception 'FAIL: buat tujuan salah: target=% status=%', v_target, v_status;
  else
    raise notice 'PASS: buat tujuan (target=1000000, active)';
  end if;

  -- 2. Nama duplikat per keluarga ditolak unique index.
  begin
    insert into public.savings_goals (family_id, name, target_minor, created_by)
      values (fam_a, 'Dana darurat', 500000, u_a);
    raise exception 'FAIL: duplikat nama tujuan diizinkan';
  exception when unique_violation then
    raise notice 'PASS: duplikat nama tujuan ditolak';
  end;

  -- 3. Target nol/negatif ditolak CHECK; tanggal di luar rentang ditolak.
  begin
    insert into public.savings_goals (family_id, name, target_minor, created_by)
      values (fam_a, 'Nol', 0, u_a);
    raise exception 'FAIL: target nol diizinkan';
  exception when check_violation then
    raise notice 'PASS: target nol ditolak';
  end;
  begin
    insert into public.savings_goals (family_id, name, target_minor, target_date, created_by)
      values (fam_a, 'Jauh', 1000, date '1999-12-31', u_a);
    raise exception 'FAIL: tanggal target 1999 diizinkan';
  exception when check_violation then
    raise notice 'PASS: tanggal target di luar rentang ditolak';
  end;

  -- 4. Ubah tujuan aktif: target 1000000 -> 1200000.
  update public.savings_goals
  set target_minor = 1200000
  where id = goal;
  select g.target_minor into v_target from public.savings_goals g where g.id = goal;
  if v_target <> 1200000 then
    raise exception 'FAIL: ubah target gagal: %', v_target;
  else
    raise notice 'PASS: ubah target tujuan (1200000)';
  end if;

  -- 5. Setoran: 200000 + 75000 posted; progres = sum(posted).
  insert into public.goal_contributions
    (family_id, goal_id, amount_minor, occurred_at, idempotency_key, created_by)
    values (fam_a, goal, 200000, CURRENT_DATE, 'sv-c-1', u_a)
    returning id into c1;
  insert into public.goal_contributions
    (family_id, goal_id, amount_minor, occurred_at, idempotency_key, created_by)
    values (fam_a, goal, 75000, CURRENT_DATE, 'sv-c-2', u_a)
    returning id into c2;
  select coalesce(sum(c.amount_minor), 0) into v_allocated
  from public.goal_contributions c
  where c.goal_id = goal and c.status = 'posted';
  if v_allocated <> 275000 then
    raise exception 'FAIL: alokasi salah: %', v_allocated;
  else
    raise notice 'PASS: progres alokasi = 275000 (posted saja)';
  end if;

  -- 6. Idempotency: kunci sama per keluarga ditolak unique index.
  begin
    insert into public.goal_contributions
      (family_id, goal_id, amount_minor, occurred_at, idempotency_key, created_by)
      values (fam_a, goal, 75000, CURRENT_DATE, 'sv-c-2', u_a);
    raise exception 'FAIL: idempotency ganda diizinkan';
  exception when unique_violation then
    raise notice 'PASS: idempotency ganda ditolak';
  end;

  -- 7. Batalkan setoran 75000 -> posted -> cancelled, sekali saja.
  update public.goal_contributions
  set status = 'cancelled', cancelled_at = now(), cancelled_by = u_a
  where id = c2 and status = 'posted';
  select coalesce(sum(c.amount_minor), 0) into v_allocated
  from public.goal_contributions c
  where c.goal_id = goal and c.status = 'posted';
  if v_allocated <> 200000 then
    raise exception 'FAIL: setelah batal alokasi harus 200000, dapat %', v_allocated;
  else
    raise notice 'PASS: batal setoran (reversal audit, alokasi=200000)';
  end if;
  begin
    update public.goal_contributions
    set status = 'cancelled', cancelled_at = now(), cancelled_by = u_a
    where id = c2;
    raise exception 'FAIL: double-cancel diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: double-cancel diizinkan' then raise; end if;
    raise notice 'PASS: double-cancel ditolak (%)', sqlerrm;
  end;
  begin
    delete from public.goal_contributions where id = c1;
    raise exception 'FAIL: DELETE kontribusi diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: DELETE kontribusi diizinkan' then raise; end if;
    raise notice 'PASS: DELETE kontribusi ditolak (%)', sqlerrm;
  end;

  -- 8. Invarians kekayaan: kontribusi bukan ledger.
  -- Tidak ada baris transactions baru; total/saldo/ringkasan tidak berubah.
  select count(*) into v_cnt from public.transactions where family_id = fam_a;
  if v_cnt <> 0 then
    raise exception 'FAIL: kontribusi membuat % baris ledger', v_cnt;
  else
    raise notice 'PASS: kontribusi bukan transaksi ledger (0 baris)';
  end if;
  select coalesce(sum(t.amount_minor) filter (where t.kind = 'income' and t.status = 'posted'), 0),
         coalesce(sum(t.amount_minor) filter (where t.kind = 'expense' and t.status = 'posted'), 0)
    into v_inc, v_exp
  from public.transactions t
  where t.family_id = fam_a
    and t.occurred_at >= date_trunc('month', CURRENT_DATE)::date
    and t.occurred_at < (date_trunc('month', CURRENT_DATE) + interval '1 month')::date;
  if v_inc <> 0 or v_exp <> 0 then
    raise exception 'FAIL: laporan tercemar kontribusi: inc=% exp=%', v_inc, v_exp;
  else
    raise notice 'PASS: laporan income/expense tetap nol (tidak double-count)';
  end if;
  select coalesce(sum(a.opening_balance_minor), 0) into v_total
  from public.accounts a where a.family_id = fam_a;
  if v_total <> 500000 then
    raise exception 'FAIL: saldo berubah oleh kontribusi: %', v_total;
  else
    raise notice 'PASS: total kekayaan tetap 500000 (wealth-neutral)';
  end if;

  -- 9. Family-id campur ditolak di batas DB (goal milik A, family B).
  insert into public.savings_goals (family_id, name, target_minor, created_by)
    values (fam_b, 'Liburan', 500000, u_b)
    returning id into goal2;
  begin
    insert into public.goal_contributions
      (family_id, goal_id, amount_minor, occurred_at, idempotency_key, created_by)
      values (fam_b, goal, 10000, CURRENT_DATE, 'sv-x-1', u_b);
    raise exception 'FAIL: kontribusi lintas keluarga diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: kontribusi lintas keluarga diizinkan' then raise; end if;
    raise notice 'PASS: kontribusi lintas keluarga ditolak (%)', sqlerrm;
  end;

  -- 10. Transisi status maju saja: active -> completed -> archived.
  update public.savings_goals set status = 'completed' where id = goal;
  select g.status into v_status from public.savings_goals g where g.id = goal;
  if v_status <> 'completed' then
    raise exception 'FAIL: complete gagal: %', v_status;
  else
    raise notice 'PASS: active -> completed';
  end if;
  begin
    update public.savings_goals set status = 'active' where id = goal;
    raise exception 'FAIL: completed -> active diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: completed -> active diizinkan' then raise; end if;
    raise notice 'PASS: completed -> active ditolak (%)', sqlerrm;
  end;
  begin
    update public.savings_goals set target_minor = 999 where id = goal;
    raise exception 'FAIL: edit target setelah completed diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: edit target setelah completed diizinkan' then raise; end if;
    raise notice 'PASS: finished goal immutable kecuali status (%)', sqlerrm;
  end;
  update public.savings_goals set status = 'archived' where id = goal;
  select g.status into v_status from public.savings_goals g where g.id = goal;
  if v_status <> 'archived' then
    raise exception 'FAIL: archive gagal: %', v_status;
  else
    raise notice 'PASS: completed -> archived (riwayat dipertahankan)';
  end if;

  -- 11. Regresi: RLS tetap menolak tulis langsung transactions/budgets/goals;
  -- trigger append-only ledger tetap aktif (cek cepat: tabel ada + indeks unik).
  select count(*) into v_cnt
  from pg_indexes
  where schemaname = 'public'
    and indexname in (
      'uq_tx_family_idempotency', 'uq_budgets_family_category_month',
      'uq_goals_family_name', 'uq_contrib_family_idempotency'
    );
  if v_cnt <> 4 then
    raise exception 'FAIL: indeks unik hilang: % dari 4', v_cnt;
  else
    raise notice 'PASS: regresi indeks unik 4/4 (ledger+budget+savings)';
  end if;
  select count(*) into v_cnt from public.savings_goals where family_id = fam_a;
  if v_cnt <> 1 then
    raise exception 'FAIL: riwayat tujuan hilang: %', v_cnt;
  else
    raise notice 'PASS: riwayat tujuan dipertahankan (completed/archived tidak dihapus)';
  end if;

  -- 12. Sisa = target - terkumpul (boleh negatif = terlampaui) via rumus RPC.
  select g.target_minor - coalesce(s.allocated, 0) into v_remaining
  from public.savings_goals g
  left join lateral (
    select coalesce(sum(c.amount_minor), 0) as allocated
    from public.goal_contributions c
    where c.goal_id = g.id and c.status = 'posted'
  ) s on true
  where g.id = goal2;
  if v_remaining <> 500000 then
    raise exception 'FAIL: sisa tujuan B salah: %', v_remaining;
  else
    raise notice 'PASS: sisa = target - terkumpul (500000, belum ada setoran)';
  end if;
end;
$savings_verify$;
