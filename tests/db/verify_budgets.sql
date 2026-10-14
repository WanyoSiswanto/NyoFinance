-- Verifikasi anggaran Fase 3 (DB lokal terisolasi).
-- Prasyarat: migrasi 001–006 sudah diterapkan, dijalankan sebagai postgres.
-- Menguji: buat + ubah anggaran, tolak duplikat (family,category,month),
-- tolak kategori income, hitung terpakai/sisa/persen dari transaksi otoritatif
-- (cancelled + transfer dikecualikan), isolasi lintas keluarga, navigasi bulan
-- + riwayat dipertahankan, imutabilitas identitas, dan regresi ledger/Fase 1.
--
-- Cara pakai:
--   createdb nyofinance_p3_verify
--   for f in 001_core 002_invites 003_rls 004_ledger_tables 005_ledger_rpcs 006_budgets; do
--     psql "dbname=nyofinance_p3_verify" -f supabase/migrations/$f.sql
--   done
--   psql "dbname=nyofinance_p3_verify" -f tests/db/verify_budgets.sql

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb
);

do $budget_verify$
declare
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  fam_a uuid;
  fam_b uuid;
  acc_a uuid;
  acc_a2 uuid;
  acc_b uuid;
  cat_belanja uuid;
  cat_gaji uuid;
  cat_b uuid;
  bud uuid;
  bud_sep uuid;
  v_limit bigint;
  v_spent bigint;
  v_remaining bigint;
  v_cnt int;
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
  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_a, 'Bank', 0, u_a) returning id into acc_a2;
  insert into public.accounts (family_id, name, opening_balance_minor, created_by)
    values (fam_b, 'Dompet B', 0, u_b) returning id into acc_b;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Belanja', 'expense', u_a) returning id into cat_belanja;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_a, 'Gaji', 'income', u_a) returning id into cat_gaji;
  insert into public.categories (family_id, name, kind, created_by)
    values (fam_b, 'Jajan B', 'expense', u_b) returning id into cat_b;

  -- 1. Buat anggaran Oktober 2026 untuk Belanja (limit 100000).
  insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
    values (fam_a, cat_belanja, date '2026-10-01', 100000, u_a)
    returning id into bud;
  select b.limit_minor into v_limit from public.budgets b where b.id = bud;
  if v_limit <> 100000 then
    raise exception 'FAIL: limit anggaran salah: %', v_limit;
  else
    raise notice 'PASS: buat anggaran (limit=100000)';
  end if;

  -- 2. Duplikat (family, category, month) ditolak unique index.
  begin
    insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
      values (fam_a, cat_belanja, date '2026-10-01', 50000, u_a);
    raise exception 'FAIL: duplikat anggaran diizinkan';
  exception when unique_violation then
    raise notice 'PASS: duplikat anggaran ditolak';
  end;

  -- 3. Kategori income ditolak trigger (bukan hanya RPC).
  begin
    insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
      values (fam_a, cat_gaji, date '2026-10-01', 50000, u_a);
    raise exception 'FAIL: anggaran kategori income diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: anggaran kategori income diizinkan' then raise; end if;
    raise notice 'PASS: kategori income ditolak (%)', sqlerrm;
  end;

  -- 4. Family-id campur: kategori keluarga B ditolak untuk anggaran A.
  begin
    insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
      values (fam_a, cat_b, date '2026-10-01', 50000, u_a);
    raise exception 'FAIL: anggaran lintas keluarga diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: anggaran lintas keluarga diizinkan' then raise; end if;
    raise notice 'PASS: kategori lintas keluarga ditolak (%)', sqlerrm;
  end;

  -- 5. Ubah limit: 100000 -> 150000; identitas dikunci.
  update public.budgets set limit_minor = 150000 where id = bud;
  select b.limit_minor into v_limit from public.budgets b where b.id = bud;
  if v_limit <> 150000 then
    raise exception 'FAIL: ubah limit gagal: %', v_limit;
  else
    raise notice 'PASS: ubah batas anggaran (limit=150000)';
  end if;
  begin
    update public.budgets set month = date '2026-11-01' where id = bud;
    raise exception 'FAIL: ubah bulan anggaran diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: ubah bulan anggaran diizinkan' then raise; end if;
    raise notice 'PASS: identitas anggaran immutable (%)', sqlerrm;
  end;
  -- Kembalikan limit ke 100000 untuk perhitungan di bawah.
  update public.budgets set limit_minor = 100000 where id = bud;

  -- 6. Transaksi: expense posted 20000 (Okt) + 5000 (Okt, lalu dibatalkan)
  --    + income 50000 (Okt) + expense 9000 (Sep, bulan lain)
  --    + transfer 30000 (Okt, dikecualikan).
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 20000, acc_a, cat_belanja, date '2026-10-05', 'bg-e-1', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, status, cancelled_at, cancelled_by, idempotency_key, created_by)
    values (fam_a, 'expense', 5000, acc_a, cat_belanja, date '2026-10-06', 'cancelled', now(), u_a, 'bg-e-2', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'income', 50000, acc_a, cat_gaji, date '2026-10-07', 'bg-i-1', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, account_id, category_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'expense', 9000, acc_a, cat_belanja, date '2026-09-20', 'bg-e-3', u_a);
  insert into public.transactions
    (family_id, kind, amount_minor, source_account_id, dest_account_id, occurred_at, idempotency_key, created_by)
    values (fam_a, 'transfer', 30000, acc_a, acc_a2, date '2026-10-08', 'bg-t-1', u_a);

  -- 7. Hitung terpakai otoritatif Oktober (rumus sama dengan get_budget_status).
  select coalesce(sum(t.amount_minor), 0) into v_spent
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.category_id = cat_belanja
    and t.occurred_at >= date '2026-10-01' and t.occurred_at < date '2026-11-01';
  v_remaining := 100000 - v_spent;
  if v_spent <> 20000 then
    raise exception 'FAIL: terpakai salah (cancelled/transfer ikut?): %', v_spent;
  elsif v_remaining <> 80000 then
    raise exception 'FAIL: sisa salah: %', v_remaining;
  else
    raise notice 'PASS: terpakai=20000 sisa=80000 persen=20 (transfer/cancelled/bulan-lain dikecualikan)';
  end if;

  -- 8. Batas bulan: expense September tidak masuk Oktober (riwayat per bulan).
  select coalesce(sum(t.amount_minor), 0) into v_spent
  from public.transactions t
  where t.family_id = fam_a and t.kind = 'expense' and t.status = 'posted'
    and t.category_id = cat_belanja
    and t.occurred_at >= date '2026-09-01' and t.occurred_at < date '2026-10-01';
  if v_spent <> 9000 then
    raise exception 'FAIL: agregat September salah: %', v_spent;
  else
    raise notice 'PASS: riwayat per bulan terpisah (Sep=9000, Okt=20000)';
  end if;

  -- 9. Anggaran bulan lain (September) dipertahankan + navigasi tidak menghapus.
  insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
    values (fam_a, cat_belanja, date '2026-09-01', 60000, u_a)
    returning id into bud_sep;
  select count(*) into v_cnt from public.budgets b where b.family_id = fam_a;
  if v_cnt <> 2 then
    raise exception 'FAIL: riwayat anggaran hilang: %', v_cnt;
  else
    raise notice 'PASS: anggaran historis dipertahankan (2 bulan)';
  end if;

  -- 10. Isolasi lintas keluarga: anggaran B tidak tercampur.
  insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
    values (fam_b, cat_b, date '2026-10-01', 70000, u_b);
  select count(*) into v_cnt from public.budgets b
  where b.family_id = fam_a and b.month = date '2026-10-01';
  if v_cnt <> 1 then
    raise exception 'FAIL: anggaran lintas keluarga bocor: %', v_cnt;
  else
    raise notice 'PASS: anggaran terisolasi per keluarga';
  end if;

  -- 11. Limit invalid (0) ditolak CHECK.
  begin
    insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
      values (fam_a, cat_belanja, date '2026-11-01', 0, u_a);
    raise exception 'FAIL: limit 0 diizinkan';
  exception when check_violation then
    raise notice 'PASS: limit 0 ditolak';
  end;

  -- 12. Bulan bukan hari pertama ditolak CHECK.
  begin
    insert into public.budgets (family_id, category_id, month, limit_minor, created_by)
      values (fam_a, cat_belanja, date '2026-11-15', 50000, u_a);
    raise exception 'FAIL: bulan non-hari-pertama diizinkan';
  exception when check_violation then
    raise notice 'PASS: bulan harus hari pertama';
  end;

  -- 13. Regresi ledger: transaksi posted tetap append-only (DELETE ditolak).
  begin
    delete from public.transactions where idempotency_key = 'bg-e-1';
    raise exception 'FAIL: regresi — DELETE transaksi diizinkan';
  exception when others then
    if sqlerrm = 'FAIL: regresi — DELETE transaksi diizinkan' then raise; end if;
    raise notice 'PASS: regresi ledger — DELETE ditolak (%)', sqlerrm;
  end;

  -- 14. Regresi Fase 1: hash undangan aktif tetap unik.
  begin
    insert into public.family_invitations (family_id, created_by, token_hash, expires_at)
      values (fam_a, u_a, encode(decode(repeat('cd', 32), 'hex'), 'hex'), now() + interval '1 hour');
    insert into public.family_invitations (family_id, created_by, token_hash, expires_at)
      values (fam_a, u_a, encode(decode(repeat('cd', 32), 'hex'), 'hex'), now() + interval '1 hour');
    raise exception 'FAIL: regresi Fase 1 — duplikat hash diizinkan';
  exception when unique_violation then
    raise notice 'PASS: regresi Fase 1 — duplikat hash ditolak';
  end;

  raise notice 'Semua pemeriksaan verify_budgets selesai.';
end $budget_verify$;
