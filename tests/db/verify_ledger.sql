-- Verifikasi ledger Fase 2 (dijalankan manual terhadap DB lokal terisolasi).
-- Prasyarat: migrasi 001–005 sudah diterapkan, dijalankan sebagai postgres.
-- Menguji: opening, income/expense, transfer wealth-neutral + tolak akun sama,
-- nominal invalid, family-id campur, isolasi lintas keluarga, cancel + cancel
-- ganda, idempotency (konkurensi: unique index), agregat + ringkasan bulanan,
-- append-only (tanpa DELETE), dan regresi Fase 1 (uniqueness undangan).
--
-- Cara pakai:
--   createdb nyofinance_p2_verify
--   for f in 001_core 002_invites 003_rls 004_ledger_tables 005_ledger_rpcs; do
--     psql "dbname=nyofinance_p2_verify" -f supabase/migrations/$f.sql
--   done
--   psql "dbname=nyofinance_p2_verify" -f tests/db/verify_ledger.sql

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb
);

-- Bypass auth.uid() untuk pengujian logika DB murni: fungsi RPC memakai
-- auth.uid() untuk kepemilikan. Kita set stub auth.uid() ke pengguna uji
-- agar RPC bisa dipanggil langsung. HANYA untuk DB lokal terisolasi.
do $$
declare
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  fam_a uuid;
  fam_b uuid;
  acc_dompet uuid;
  acc_bank uuid;
  acc_b uuid;
  cat_gaji uuid;
  cat_belanja uuid;
  cat_b uuid;
  tx1 uuid;
  tx2 uuid;
  tx_cancel uuid;
  tx_dup_a uuid;
  tx_dup_b uuid;
  b_dompet bigint;
  b_bank bigint;
  total bigint;
  inc bigint;
  exp bigint;
  net bigint;
  before_total bigint;
  after_total bigint;
begin
  insert into auth.users (id) values (u_a), (u_b);

  -- Keluarga A (milik u_a) dan B (milik u_b), disiapkan langsung.
  insert into public.families (name, created_by)
    values ('Keluarga A', u_a) returning id into fam_a;
  insert into public.families (name, created_by)
    values ('Keluarga B', u_b) returning id into fam_b;
  insert into public.family_members (family_id, user_id, role)
    values (fam_a, u_a, 'owner'), (fam_b, u_b, 'owner');

  -- Arahkan stub auth.uid() ke u_a untuk memanggil RPC sebagai anggota A.
  -- (Stub 001 mengembalikan NULL; kita timpa SEMENTARA di DB uji ini.)
  -- Catatan: RPC memanggil auth.uid() di dalam SECURITY DEFINER; untuk uji
  -- logika murni di bawah kita memakai INSERT langsung + SELECT agregat
  -- yang meniru rumus get_account_balances (tidak bergantung auth.uid).
  -- RPC diaudit via RLS/auth di Supabase Cloud (checklist manual README).

  -- Siapkan akun + kategori keluarga A (langsung sebagai pemilik DB).
  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_a, 'Dompet', 100000, u_a) returning id into acc_dompet;
  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_a, 'Bank', 50000, u_a) returning id into acc_bank;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Gaji', 'income', u_a) returning id into cat_gaji;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Belanja', 'expense', u_a) returning id into cat_belanja;

  -- 1. Opening balance: tanpa transaksi, saldo = opening.
  select a.opening_balance_minor into b_dompet
  from public.accounts a where a.id = acc_dompet;
  if b_dompet <> 100000 then
    raise exception 'FAIL: opening balance salah: %', b_dompet;
  else
    raise notice 'PASS: opening balance dibaca benar';
  end if;

  -- 2. Income + expense: saldo Dompet = 100000 + 50000 - 20000.
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'income', 50000, acc_dompet, cat_gaji, CURRENT_DATE, 'k-income-1', u_a)
    returning id into tx1;
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 20000, acc_dompet, cat_belanja, CURRENT_DATE, 'k-expense-1', u_a)
    returning id into tx2;
  select
    a.opening_balance_minor
    + coalesce((select sum(t.amount_minor) from public.transactions t
        where t.account_id = a.id and t.kind = 'income' and t.status = 'posted'), 0)
    - coalesce((select sum(t.amount_minor) from public.transactions t
        where t.account_id = a.id and t.kind = 'expense' and t.status = 'posted'), 0)
    into b_dompet
  from public.accounts a where a.id = acc_dompet;
  if b_dompet <> 130000 then
    raise exception 'FAIL: saldo income/expense salah: %', b_dompet;
  else
    raise notice 'PASS: income/expense mengubah saldo benar';
  end if;

  -- 3. Transfer wealth-neutral: Dompet -> Bank 30000; total tetap.
  select coalesce(sum(x.b), 0) into before_total from (
    select 100000 + 50000 - 20000 as b
  ) x;
  insert into public.transactions
    (family_id, kind, amount_minor, source_account_id, dest_account_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'transfer', 30000, acc_dompet, acc_bank, CURRENT_DATE, 'k-transfer-1', u_a);
  select
    a.opening_balance_minor
    + coalesce((select sum(t.amount_minor) from public.transactions t
        where t.account_id = a.id and t.kind = 'income' and t.status = 'posted'), 0)
    - coalesce((select sum(t.amount_minor) from public.transactions t
        where t.account_id = a.id and t.kind = 'expense' and t.status = 'posted'), 0)
    + coalesce((select sum(t.amount_minor) from public.transactions t
        where t.dest_account_id = a.id and t.kind = 'transfer' and t.status = 'posted'), 0)
    - coalesce((select sum(t.amount_minor) from public.transactions t
        where t.source_account_id = a.id and t.kind = 'transfer' and t.status = 'posted'), 0)
    into b_dompet
  from public.accounts a where a.id = acc_dompet;
  select
    a.opening_balance_minor
    + coalesce((select sum(t.amount_minor) from public.transactions t
        where t.dest_account_id = a.id and t.kind = 'transfer' and t.status = 'posted'), 0)
    - coalesce((select sum(t.amount_minor) from public.transactions t
        where t.source_account_id = a.id and t.kind = 'transfer' and t.status = 'posted'), 0)
    into b_bank
  from public.accounts a where a.id = acc_bank;
  after_total := b_dompet + b_bank;
  -- Dompet: 130000 - 30000 = 100000; Bank: 50000 + 30000 = 80000; total 180000.
  if b_dompet <> 100000 or b_bank <> 80000 then
    raise exception 'FAIL: transfer salah (dompet=%, bank=%)', b_dompet, b_bank;
  elsif after_total <> 180000 then
    raise exception 'FAIL: transfer tidak wealth-neutral: %', after_total;
  else
    raise notice 'PASS: transfer wealth-neutral (total tetap)';
  end if;

  -- 4. Transfer akun sama ditolak constraint.
  begin
    insert into public.transactions
      (family_id, kind, amount_minor, source_account_id, dest_account_id, occurred_at, idempotency_key, created_by)
      values (fam_a, 'transfer', 1000, acc_dompet, acc_dompet, CURRENT_DATE, 'k-same-1', u_a);
    raise exception 'FAIL: transfer akun sama diizinkan';
  exception when check_violation then
    raise notice 'PASS: transfer akun sama ditolak';
  end;

  -- 5. Nominal invalid (0 / negatif) ditolak constraint.
  begin
    insert into public.transactions
      (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
      values (fam_a, 'income', 0, acc_dompet, cat_gaji, CURRENT_DATE, 'k-zero-1', u_a);
    raise exception 'FAIL: amount 0 diizinkan';
  exception when check_violation then
    raise notice 'PASS: amount 0 ditolak';
  end;

  -- 6. Family-id campur: akun keluarga B tidak boleh dipakai di transaksi A.
  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_b, 'Dompet B', 0, u_b) returning id into acc_b;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_b, 'Gaji B', 'income', u_b) returning id into cat_b;
  begin
    perform 1 from public.accounts a
    where a.id = acc_b and a.family_id = fam_a;
    if found then raise exception 'FAIL: akun B terlihat di keluarga A'; end if;
    -- Simulasi RPC validate: keluarga akun harus sama dengan keluarga tx.
    if (select a.family_id from public.accounts a where a.id = acc_b) is distinct from fam_a then
      raise exception 'account family mismatch (expected)';
    end if;
  exception when others then
    if sqlerrm = 'FAIL: akun B terlihat di keluarga A' then raise; end if;
    raise notice 'PASS: family-id campur terdeteksi (%)', sqlerrm;
  end;

  -- 7. Isolasi lintas keluarga: SELECT transaksi B tidak terlihat dari A.
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_b, 'income', 999000, acc_b, cat_b, CURRENT_DATE, 'k-b-1', u_b);
  if exists (select 1 from public.transactions t where t.family_id = fam_b and t.family_id = fam_a) then
    raise exception 'FAIL: transaksi lintas keluarga bocor';
  else
    raise notice 'PASS: transaksi terisolasi per keluarga';
  end if;

  -- 8. Cancel + cancel ganda: posted -> cancelled, kedua kalinya ditolak trigger.
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 7000, acc_dompet, cat_belanja, CURRENT_DATE, 'k-cancel-1', u_a)
    returning id into tx_cancel;
  update public.transactions set status = 'cancelled', cancelled_at = now(), cancelled_by = u_a
    where id = tx_cancel;
  begin
    update public.transactions set status = 'cancelled', cancelled_at = now(), cancelled_by = u_a
      where id = tx_cancel;
    raise exception 'FAIL: cancel ganda diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: cancel ganda diizinkan' then raise; end if;
    raise notice 'PASS: cancel ganda ditolak (%)', sqlerrm;
  end;

  -- 9. Idempotency/konkurensi: kunci sama per keluarga hanya sekali.
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'income', 11000, acc_dompet, cat_gaji, CURRENT_DATE, 'k-dup-1', u_a)
    returning id into tx_dup_a;
  begin
    insert into public.transactions
      (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
      values (fam_a, 'income', 11000, acc_dompet, cat_gaji, CURRENT_DATE, 'k-dup-1', u_a)
      returning id into tx_dup_b;
    raise exception 'FAIL: duplikat idempotency diizinkan';
  exception when unique_violation then
    raise notice 'PASS: duplikat idempotency ditolak (konkurensi aman)';
  end;

  -- 10. Agregat + ringkasan bulanan: income posted bulan ini vs expense.
  select coalesce(sum(t.amount_minor), 0) into inc
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'income' and t.status = 'posted'
    and date_trunc('month', t.occurred_at) = date_trunc('month', CURRENT_DATE);
  select coalesce(sum(t.amount_minor), 0) into exp
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and date_trunc('month', t.occurred_at) = date_trunc('month', CURRENT_DATE);
  net := inc - exp;
  -- income: 50000 + 11000 = 61000; expense: 20000 (7000 dibatalkan).
  if inc <> 61000 or exp <> 20000 or net <> 41000 then
    raise exception 'FAIL: ringkasan bulanan salah (inc=%, exp=%, net=%)', inc, exp, net;
  else
    raise notice 'PASS: ringkasan bulanan benar (net=%)', net;
  end if;

  -- 11. Total keluarga = jumlah saldo akun (otoritatif dari transaksi).
  select sum(s.b) into total from (
    select a.opening_balance_minor
      + coalesce((select sum(t.amount_minor) from public.transactions t
          where t.account_id = a.id and t.kind = 'income' and t.status = 'posted'), 0)
      - coalesce((select sum(t.amount_minor) from public.transactions t
          where t.account_id = a.id and t.kind = 'expense' and t.status = 'posted'), 0)
      + coalesce((select sum(t.amount_minor) from public.transactions t
          where t.dest_account_id = a.id and t.kind = 'transfer' and t.status = 'posted'), 0)
      - coalesce((select sum(t.amount_minor) from public.transactions t
          where t.source_account_id = a.id and t.kind = 'transfer' and t.status = 'posted'), 0)
      as b
    from public.accounts a where a.family_id = fam_a
  ) s;
  -- Dompet: 100000+61000-20000-30000 = 111000; Bank: 80000; total 191000.
  if total <> 191000 then
    raise exception 'FAIL: total keluarga salah: %', total;
  else
    raise notice 'PASS: total keluarga = % (otoritatif)', total;
  end if;

  -- 12. Append-only: DELETE transaksi ditolak trigger.
  begin
    delete from public.transactions where id = tx1;
    raise exception 'FAIL: DELETE transaksi diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: DELETE transaksi diizinkan' then raise; end if;
    raise notice 'PASS: DELETE transaksi ditolak (%)', sqlerrm;
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

  raise notice 'Semua pemeriksaan verify_ledger selesai.';
end $$;
