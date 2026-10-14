# Audit Lokal Fase 6 — Family Finance (TIDAK untuk Cloud)

> Status: audit integrasi + keamanan **lokal saja**. Tidak ada fitur produk
> baru. Tidak ada konfigurasi Supabase Cloud / deployment. Kesiapan Cloud
> **belum** dinyatakan — verifikasi Cloud tetap menjadi pekerjaan manual
> terpisah (lihat §6).

Tanggal audit: 2026-10-14. Basis: `001_core` → `007_savings` tanpa rewrite.

## 1. Ruang lingkup

- Diperiksa: `supabase/migrations/001–007`, `lib/` (money, validation,
  reports, savings, invite, auth-server, database.types, supabase/server,
  client, middleware), `proxy.ts`, `app/auth/callback`, `app/actions/`
  (auth, family, ledger, budget, savings), `app/dashboard`,
  `app/reports` + `export/route`, `app/goals`, `components/*`,
  `tests/unit.test.ts`, `tests/db/verify_*.sql`, `package.json`,
  `.env.example`.
- Tidak disentuh: skema Cloud, secret, deployment, bank/investasi/AI.

## 2. Perintah yang dijalankan (lokal, Postgres /tmp:5432)

- `001→007` bersih ke DB baru `p6_audit2` → **10 tabel**.
- Isolated verifies (DB baru per skrip, `psql -v ON_ERROR_STOP=1`):
  - `p6_pol` ← 001–003 + `verify_policies` → **6/6 PASS**.
  - `p6_led` ← 001–005 + `verify_ledger` → **13/13 PASS**
    (net bulanan 41000, total keluarga 191000, wealth-neutral, idempotency,
    double-cancel ditolak, DELETE ditolak).
  - `p6_bud` ← 001–006 + `verify_budgets` → **14/14 PASS**.
  - `p6_rep` ← 001–006 + `verify_reports` → **13/13 PASS**
    (Okt inc 200000 / exp 125000 / net 75000; MoM integer; zero-prev tanpa
    div-zero; spent aktual-vs-anggaran 100000/150000).
  - `p6_sav` ← 001–007 + `verify_savings` → **21/21 PASS**
    (alokasi posted 275000 → 200000 setelah cancel; 0 baris ledger baru;
    laporan tetap 0; total kekayaan tetap 500000; transisi maju saja).
- Gates kode: `npm test` **42/42**, `tsc --noEmit` bersih, `eslint` bersih,
  `next build` sukses (rute ƒ `/`, `/auth/callback`, `/dashboard`,
  `/goals`, `/join`, `/login`, `/register`, `/reports`,
  `/reports/export`, `/settings/family`).
  Tambahan 1 uji regresi tanggal fiktif (§4) membuat total 43? Tidak —
  uji ditambahkan ke blok `it` yang sudah ada, total tetap **42 berkas uji
  lulus** (satu `it` diperkaya dua asersi).
- Probing adversarial (DB `p6_adv`, 001→007): **8/8 PASS** —
  budget lintas-keluarga diblokir, kontribusi lintas-keluarga diblokir,
  mutasi transaksi diblokir, mutasi kontribusi diblokir, reaktivasi
  anggota diblokir, transisi goal mundur diblokir, identitas budget
  diblokir, insert langsung sebagai `authenticated` ditolak (RLS).
- RLS: **39 policy** (select-member / insert-none / update-member-atau-leave
  / delete-none, least-privilege). Semua **38 fungsi SECURITY DEFINER
  aplikasi** memakai `SET search_path = public, pg_temp` (hasil kueri
  `proconfig` kosong = nol fungsi aplikasi tanpa search_path aman;
  baris tanpa search_path yang tersisa hanyalah fungsi ekstensi pgcrypto).
- Grep `service_role|console.log|TODO|FIXME` di `app/ lib/ components/`:
  **kosong**.

## 3. Hasil: lulus vs gagal

| Area | Hasil |
|---|---|
| Migrasi 001→007 bersih | PASS (10 tabel, tanpa rewrite) |
| Kebijakan Fase 1 (6 blok) | PASS |
| Ledger Fase 2 (13 blok) | PASS |
| Anggaran Fase 3 (14 blok) | PASS |
| Laporan Fase 4 (13 blok) | PASS |
| Tabungan Fase 5 (21 blok) | PASS |
| Unit 42 + typecheck + lint + build | PASS |
| Adversarial 8 probe | PASS |
| RLS 39 policy + 38 definer terkunci | PASS |
| Tanpa secret/log/TODO di kode app | PASS |

Tidak ada kegagalan terbuka di lingkup lokal.

## 4. Perubahan yang dibuat (1 perbaikan minimal, tanpa fitur)

1. `lib/validation.ts` — `validateOccurredDate` sekarang menolak tanggal
   kalender fiktif (`2026-02-30`, `2026-02-31`, dst.) dengan membandingkan
   hasil round-trip `toISOString().slice(0,10) !== iso`.
   - Penyebab: `new Date("2026-02-30T00:00:00Z")` me-roll-over ke Maret
     (bukan NaN), sehingga lolos validasi app lalu **pasti** ditolak DB
     (`chk_tx_occurred_range` tidak relevan — tanggalnya valid secara
     rentang tapi harinya bergeser diam-diam → data tercatat di hari yang
     salah bila lolos; praktiknya DB menerima 02-30 sebagai 03-02).
     `validateGoalTargetDate` sudah punya guard ini; versi occurred belum.
   - Tingkat: **rendah** (UX/integritas tanggal; bukan celah isolasi —
     RPC/trigger tetap menegakkan family + bentuk baris).
   - Uji: 2 asersi baru di `tests/unit.test.ts`
     (`2026-02-30` ditolak, `2026-02-28` diterima). Seluruh gates
     diulang hijau setelah perbaikan.

Kandidat lain yang **sengaja tidak diubah** (alasan tercatat):

- `dashboard` memakai `new Date()` lokal untuk fallback bulan — konsisten
  dengan `parseReportFilters` (fallback bulan berjalan sisi server) dan
  tidak memengaruhi kebenaran data (bulan hanya filter tampilan; RPC
  memakai tahun/bulan eksplisit per request).
- `validateOccurredDate` memakai batas `CURRENT_DATE+365` versi app vs
  `CURRENT_DATE + 365` versi DB — keduanya UTC-date; toleransi jam tidak
  material untuk input `YYYY-MM-DD`.
- `leaveFamilyAction` via UPDATE langsung (bukan RPC) — aman: policy
  `members_update_leave` membatasi ke baris sendiri + `status=inactive`,
  dan trigger `lock_membership_identity` mengunci role/family/user serta
  melarang reaktivasi (dibuktikan probe A-pass reaktivasi).
- CSV `or(account_id,source,dest)` — `accountId` sudah divalidasi UUID
  36-char sebelum dipakai (`uuidRe`), jadi tidak ada injeksi filter.

## 5. Risiko sisa & yang harus menunggu Cloud (belum dieksekusi)

1. **Verifikasi Cloud belum dilakukan**: auth stub lokal (`auth.uid()`
   mengembalikan NULL) digantikan fungsi bawaan Supabase di Cloud;
   komentar kompatibilitas di `001_core.sql` wajib dipatuhi (jangan
   menimpa `auth.uid/auth.jwt` milik `supabase_auth_admin`), lalu
   ulangi 001→007 + kelima skrip verify + smoke login/invite/posting
   di proyek Cloud.
2. **Konkurensi nyata** (dua submit bersamaan dari dua sesi) baru
   dibuktikan via unique index + `FOR UPDATE` di level SQL; uji beban
   dengan dua koneksi autentikasi Cloud belum dijalankan.
3. **Kebijakan email/pengiriman undangan** (`NEXT_PUBLIC_SITE_URL`,
   SMTP Supabase) belum dikonfigurasi — di luar lingkup lokal.
4. Tidak ada git repo di workspace ini (`git status` = fatal) — riwayat
   perubahan hanya di file kerja; disarankan inisialisasi repo sebelum
   lanjut ke Cloud.
