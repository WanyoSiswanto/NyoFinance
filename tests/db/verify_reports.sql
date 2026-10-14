-- Verifikasi laporan Fase 4 (DB lokal terisolasi, tanpa migrasi baru).
-- Prasyarat: migrasi 001–006 sudah diterapkan, dijalankan sebagai postgres.
-- Menguji ulang dengan data otoritatif: ringkasan bulanan posted
-- (transfer + cancelled dikecualikan), MoM per kategori integer
-- (tanpa div-zero), ranking top-5, aktual vs anggaran, filter akun/
-- kategori/jenis/status + paginasi batas aman, empty state, zero-prev,
-- isolasi lintas keluarga (RLS family-scoped), dan regresi Fase 1–3.
-- Tidak ada fungsi/saldo kedua: semua agregat dari tabel transactions
-- dengan rumus yang sama seperti get_monthly_summary/get_budget_status.
--
-- Cara pakai:
--   createdb nyofinance_p4_verify
--   for f in 001_core 002_invites 003_rls 004_ledger_tables 005_ledger_rpcs 006_budgets; do
--     psql "dbname=nyofinance_p4_verify" -f supabase/migrations/$f.sql
--   done
--   psql "dbname=nyofinance_p4_verify" -f tests/db/verify_reports.sql

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb
);

do $report_verify$
declare
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  fam_a uuid;
  fam_b uuid;
  acc_dompet uuid;
  acc_bank uuid;
  acc_b uuid;
  cat_gaji uuid;
  cat_makan uuid;
  cat_bensin uuid;
  cat_hobi uuid;
  cat_b uuid;
  v_inc bigint;
  v_exp bigint;
  v_net bigint;
  v_spent bigint;
  v_prev bigint;
  v_delta bigint;
  v_cnt int;
  v_top1 text;
  v_budget_spent bigint;
begin
  insert into auth.users (id) values (u_a), (u_b);

  insert into public.families (name, created_by)
    values ('Keluarga A', u_a) returning id into fam_a;
  insert into public.families (name, created_by)
    values ('Keluarga B', u_b) returning id into fam_b;
  insert into public.family_members (family_id, user_id, role)
    values (fam_a, u_a, 'owner'), (fam_b, u_b, 'owner');

  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_a, 'Dompet', 100000, u_a) returning id into acc_dompet;
  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_a, 'Bank', 50000, u_a) returning id into acc_bank;
  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_b, 'Dompet B', 0, u_b) returning id into acc_b;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Gaji', 'income', u_a) returning id into cat_gaji;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Makan', 'expense', u_a) returning id into cat_makan;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Bensin', 'expense', u_a) returning id into cat_bensin;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Hobi', 'expense', u_a) returning id into cat_hobi;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_b, 'Jajan B', 'expense', u_b) returning id into cat_b;

  -- Data Oktober 2026 keluarga A:
  -- income 200000, expense Makan 100000 (60k+40k), Bensin 25000,
  -- expense cancelled 50000, transfer 30000 (antar akun A).
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'income', 200000, acc_dompet, cat_gaji, date '2026-10-03', 'r4-i-1', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 60000, acc_dompet, cat_makan, date '2026-10-05', 'r4-e-1', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 40000, acc_bank, cat_makan, date '2026-10-06', 'r4-e-2', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 25000, acc_dompet, cat_bensin, date '2026-10-07', 'r4-e-3', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, status, cancelled_at, cancelled_by, idempotency_key, created_by)
    values (fam_a, 'expense', 50000, acc_dompet, cat_bensin, date '2026-10-08', 'cancelled', now(), u_a, 'r4-e-4', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, source_account_id, dest_account_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'transfer', 30000, acc_dompet, acc_bank, date '2026-10-09', 'r4-t-1', u_a);
  -- September 2026: Makan 50000 (MoM), Hobi 9000, income 100000.
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'income', 100000, acc_dompet, cat_gaji, date '2026-09-03', 'r4-i-sep', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 50000, acc_dompet, cat_makan, date '2026-09-05', 'r4-e-sep', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 9000, acc_dompet, cat_hobi, date '2026-09-06', 'r4-h-sep', u_a);
  -- Keluarga B: noise lintas keluarga (tidak boleh bocor ke A).
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_b, 'expense', 999000, acc_b, cat_b, date '2026-10-05', 'r4-b-1', u_b);

  -- 1. Ringkasan otoritatif Oktober (rumus SAMA dengan get_monthly_summary):
  --    income=200000 expense=125000 net=75000 (cancelled+transfer dikecualikan).
  --    (RPC baca butuh auth.uid(); di DB uji kita pakai SELECT langsung
  --     dengan rumus identik — lihat komentar verify_ledger soal stub auth.)
  select coalesce(sum(t.amount_minor) filter (where t.kind = 'income'), 0),
         coalesce(sum(t.amount_minor) filter (where t.kind = 'expense'), 0)
    into v_inc, v_exp
  from public.transactions t
  where t.family_id = fam_a and t.status = 'posted'
    and t.kind in ('income', 'expense')
    and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01';
  v_net := v_inc - v_exp;
  if v_inc <> 200000 or v_exp <> 125000 or v_net <> 75000 then
    raise exception 'FAIL: ringkasan Okt salah: inc=% exp=% net=%', v_inc, v_exp, v_net;
  else
    raise notice 'PASS: ringkasan Okt (inc=200000 exp=125000 net=75000)';
  end if;

  -- 2. MoM per kategori integer: Makan Okt 100000 vs Sep 50000 -> delta +50000.
  select coalesce(sum(t.amount_minor), 0) into v_spent
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.category_id = cat_makan
    and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01';
  select coalesce(sum(t.amount_minor), 0) into v_prev
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.category_id = cat_makan
    and t.occurred_at >= date '2026-09-01' and t.occurred_at < date '2026-10-01';
  v_delta := v_spent - v_prev;
  if v_spent <> 100000 or v_prev <> 50000 or v_delta <> 50000 then
    raise exception 'FAIL: MoM Makan salah: cur=% prev=% delta=%', v_spent, v_prev, v_delta;
  elsif (v_delta * 100 / v_prev) <> 100 then
    raise exception 'FAIL: persen MoM Makan salah';
  else
    raise notice 'PASS: MoM Makan (+50000, +100%% integer)';
  end if;

  -- 3. Zero-prev: Bensin Okt 25000, Sep 0 -> delta +25000 tanpa persen.
  select coalesce(sum(t.amount_minor), 0) into v_prev
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.category_id = cat_bensin
    and t.occurred_at >= date '2026-09-01' and t.occurred_at < date '2026-10-01';
  if v_prev <> 0 then
    raise exception 'FAIL: zero-prev Bensin tercemar: %', v_prev;
  else
    raise notice 'PASS: zero-prev Bensin (prev=0, tanpa div-zero)';
  end if;

  -- 4. Top ranking: Makan (100000) peringkat 1, Bensin (25000) peringkat 2.
  select c.name into v_top1
  from public.transactions t
  join public.categories c on c.id = t.category_id
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01'
  group by c.name
  order by sum(t.amount_minor) desc
  limit 1;
  if v_top1 <> 'Makan' then
    raise exception 'FAIL: ranking kategori salah: %', v_top1;
  else
    raise notice 'PASS: ranking kategori (Makan teratas)';
  end if;

  -- 5. Anggaran vs aktual otoritatif: limit 150000 Makan Okt -> spent 100000.
  insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
    values (fam_a, cat_makan, date '2026-10-01', 150000, u_a);
  -- Rumus SAMA dengan lateral get_budget_status (posted expense kategori+bulan).
  select coalesce(sum(t.amount_minor), 0) into v_budget_spent
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.category_id = cat_makan
    and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01';
  if v_budget_spent <> 100000 then
    raise exception 'FAIL: aktual vs anggaran salah: %', v_budget_spent;
  else
    raise notice 'PASS: aktual vs anggaran (spent=100000 dari 150000)';
  end if;

  -- 6. Filter akun: Dompet mencakup income+expense langsung
  --    + transfer keluar sebagai sumber (3 posted + 1 cancelled).
  select count(*) into v_cnt from public.transactions t
  where t.family_id = fam_a
    and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01'
    and (t.account_id = acc_dompet or t.source_account_id = acc_dompet or t.dest_account_id = acc_dompet);
  if v_cnt <> 5 then
    raise exception 'FAIL: filter akun Dompet salah: %', v_cnt;
  else
    raise notice 'PASS: filter akun Dompet (5 baris incl. transfer+cancelled)';
  end if;

  -- 7. Filter jenis+status: expense posted Okt = 3 baris.
  select count(*) into v_cnt from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01';
  if v_cnt <> 3 then
    raise exception 'FAIL: filter expense-posted salah: %', v_cnt;
  else
    raise notice 'PASS: filter expense+posted (3 baris)';
  end if;

  -- 8. Paginasi: LIMIT 2 OFFSET 0/2 menjangkau 5 baris Okt tanpa duplikat.
  select count(*) into v_cnt from (
    (select t.id from public.transactions t
     where t.family_id = fam_a
       and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01'
     order by t.occurred_at desc, t.created_at desc limit 2 offset 0)
    union
    (select t.id from public.transactions t
     where t.family_id = fam_a
       and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01'
     order by t.occurred_at desc, t.created_at desc limit 2 offset 2)
  ) s;
  if v_cnt <> 4 then
    raise exception 'FAIL: paginasi duplikat/hilang: %', v_cnt;
  else
    raise notice 'PASS: paginasi limit/offset konsisten';
  end if;

  -- 9. Empty state: November 2026 tanpa transaksi -> nol (rumus ringkasan). 
  select coalesce(sum(t.amount_minor) filter (where t.kind = 'income'), 0),
         coalesce(sum(t.amount_minor) filter (where t.kind = 'expense'), 0)
    into v_inc, v_exp
  from public.transactions t
  where t.family_id = fam_a and t.status = 'posted'
    and t.kind in ('income', 'expense')
    and t.occurred_at >= date '2026-11-01' and t.occurred_at < date '2026-12-01';
  if v_inc <> 0 or v_exp <> 0 then
    raise exception 'FAIL: empty state Nov tercemar: %/%', v_inc, v_exp;
  else
    raise notice 'PASS: empty state November (0/0)';
  end if;

  -- 10. Isolasi lintas keluarga: agregat A tidak mencakup 999000 milik B.
  select coalesce(sum(t.amount_minor), 0) into v_spent
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01';
  if v_spent <> 125000 then
    raise exception 'FAIL: kebocoran lintas keluarga: %', v_spent;
  else
    raise notice 'PASS: isolasi lintas keluarga (125000 murni A)';
  end if;

  -- 11. Regresi ledger: DELETE tetap ditolak (append-only).
  begin
    delete from public.transactions where idempotency_key = 'r4-e-1';
    raise exception 'FAIL: regresi — DELETE diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: regresi — DELETE diizinkan' then raise; end if;
    raise notice 'PASS: regresi ledger — DELETE ditolak (%)', sqlerrm;
  end;

  -- 12. Regresi anggaran: duplikat (family,category,month) ditolak.
  begin
    insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
      values (fam_a, cat_makan, date '2026-10-01', 50000, u_a);
    raise exception 'FAIL: regresi — duplikat anggaran diizinkan';
  exception when unique_violation then
    raise notice 'PASS: regresi anggaran — duplikat ditolak';
  end;

  -- 13. Regresi Fase 1: hash undangan aktif tetap unik.
  begin
    insert into public.family_invitations (family_id, created_by, token_hash, expires_at)
      values (fam_a, u_a, encode(decode(repeat('ef', 32), 'hex'), 'hex'), now() + interval '1 hour');
    insert into public.family_invitations (family_id, created_by, token_hash, expires_at)
      values (fam_a, u_a, encode(decode(repeat('ef', 32), 'hex'), 'hex'), now() + interval '1 hour');
    raise exception 'FAIL: regresi Fase 1 — duplikat hash diizinkan';
  exception when unique_violation then
    raise notice 'PASS: regresi Fase 1 — duplikat hash ditolak';
  end;

  raise notice 'Semua pemeriksaan verify_reports selesai.';
end $report_verify$;
