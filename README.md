# NyoFinance — Fase 1 (Fondasi) + Fase 2 (Ledger) + Fase 3 (Anggaran) + Fase 4 (Laporan) + Fase 5 (Tujuan)

Aplikasi keuangan keluarga untuk suami dan istri. Fase 1 mencakup fondasi
aplikasi, autentikasi, workspace keluarga, migrasi database, dan keamanan.
Fase 2 menambah ledger keuangan: akun + saldo awal, kategori, pemasukan,
pengeluaran, transfer antar akun (wealth-neutral), riwayat, pembatalan
(append-only), saldo per akun + total keluarga, dan ringkasan kas bulanan.
Fase 3 menambah anggaran bulanan: batas per kategori expense + bulan,
terpakai/sisa/persen dari transaksi otoritatif, peringatan 80%/over,
navigasi bulan, riwayat dipertahankan, over-budget tidak memblokir transaksi.
Fase 4 menambah laporan bulanan: ringkasan kas + MoM, analisis pengeluaran
per kategori + 5 teratas + MoM per kategori, aktual vs anggaran, daftar
transaksi berfilter + paginasi, dan ekspor CSV — semuanya integer minor
units, posted-only, tanpa sistem saldo kedua.
Fase 5 menambah tujuan tabungan: target + setoran alokasi per tujuan,
progres/sisa/estimasi iuran integer, selesaikan/arsipkan (transisi maju),
riwayat setoran + pembatalan audit — alokasi murni, bukan transaksi ledger:
tidak menambah income, tidak mengubah saldo, tidak muncul di laporan.
Antarmuka berbahasa Indonesia, terang, minimal, aksen teal.

## Prasyarat

- Node.js 20+ (`node -v`)
- Proyek Supabase (cloud) atau Supabase lokal
- PostgreSQL klien `psql` (untuk migrasi manual)

## 1. Setup cepat

```bash
npm install
cp .env.example .env.local
# Isi NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# NEXT_PUBLIC_SITE_URL dari dasbor Supabase (Project Settings -> API).
npm run dev   # http://localhost:3000
```

## 2. Terapkan migrasi database

Berurutan (wajib sesuai urutan):

```bash
psql "$DATABASE_URL" -f supabase/migrations/001_core.sql
psql "$DATABASE_URL" -f supabase/migrations/002_invites.sql
psql "$DATABASE_URL" -f supabase/migrations/003_rls.sql
psql "$DATABASE_URL" -f supabase/migrations/004_ledger_tables.sql
psql "$DATABASE_URL" -f supabase/migrations/005_ledger_rpcs.sql
psql "$DATABASE_URL" -f supabase/migrations/006_budgets.sql
psql "$DATABASE_URL" -f supabase/migrations/007_savings.sql
```

`DATABASE_URL` = connection string Postgres proyek Supabase
(dasbor: Project Settings -> Database -> Connection string).
Untuk Supabase Cloud, alternatifnya: tempel isi tiap file ke SQL Editor
sesuai urutan 001 -> 002 -> 003 -> 004 -> 005 -> 006 -> 007 lalu Run.
Catatan Cloud: blok stub `auth.uid()/auth.jwt()` di 001 HANYA untuk
Postgres polos lokal — jangan timpa fungsi auth bawaan Supabase Cloud
(lihat komentar di 001_core.sql).

## 3. Konfigurasi dasbor Supabase (manual, wajib)

1. **Authentication -> Sign Up**: aktifkan Email provider.
2. **Authentication -> Email**: untuk verifikasi email, aktifkan
   "Confirm email". Aplikasi kompatibel dua-duanya:
   - Jika konfirmasi **mati** — registrasi langsung masuk.
   - Jika konfirmasi **nyala** — pengguna melihat pesan "periksa email",
     lalu klik tautan yang mengarah ke `/auth/callback`.
3. **Authentication -> URL Configuration**:
   - Site URL = `NEXT_PUBLIC_SITE_URL` (mis. `http://localhost:3000`).
   - Redirect URLs: tambahkan `http://localhost:3000/auth/callback`
     (dan URL produksi + `/auth/callback` saat deploy).
4. Tidak ada penyimpanan file / storage yang dipakai di Fase 1.
5. **Jangan pernah** menaruh service_role key di `.env.local` yang
   dibaca browser — service role hanya untuk skrip server/CI.

## 4. Perintah verifikasi

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest (Fase 1: undangan + validasi; Fase 2: minor-unit; Fase 3: anggaran; Fase 4: laporan; Fase 5: tujuan)
npm run build       # build produksi Next.js
psql "$DATABASE_URL" -f tests/db/verify_policies.sql  # cek logika DB Fase 1
psql "$DATABASE_URL" -f tests/db/verify_ledger.sql    # cek ledger Fase 2
psql "$DATABASE_URL" -f tests/db/verify_budgets.sql   # cek anggaran Fase 3
psql "$DATABASE_URL" -f tests/db/verify_reports.sql   # cek laporan Fase 4
psql "$DATABASE_URL" -f tests/db/verify_savings.sql   # cek tujuan Fase 5
```

Verifikasi terisolasi Fase 2 (tanpa menyentuh DB dev):

```bash
createdb nyofinance_p2_verify
for f in 001_core 002_invites 003_rls 004_ledger_tables 005_ledger_rpcs; do
  psql "dbname=nyofinance_p2_verify" -f supabase/migrations/$f.sql
done
psql "dbname=nyofinance_p2_verify" -f tests/db/verify_ledger.sql
```

Verifikasi terisolasi Fase 3 (tanpa menyentuh DB dev):

```bash
createdb nyofinance_p3_verify
for f in 001_core 002_invites 003_rls 004_ledger_tables 005_ledger_rpcs 006_budgets; do
  psql "dbname=nyofinance_p3_verify" -f supabase/migrations/$f.sql
done
psql "dbname=nyofinance_p3_verify" -f tests/db/verify_budgets.sql
```

Verifikasi terisolasi Fase 4 (tanpa menyentuh DB dev):

```bash
createdb nyofinance_p4_verify
for f in 001_core 002_invites 003_rls 004_ledger_tables 005_ledger_rpcs 006_budgets; do
  psql "dbname=nyofinance_p4_verify" -f supabase/migrations/$f.sql
done
psql "dbname=nyofinance_p4_verify" -f tests/db/verify_reports.sql
```

Verifikasi terisolasi Fase 5 (tanpa menyentuh DB dev):

```bash
createdb nyofinance_p5_verify
for f in 001_core 002_invites 003_rls 004_ledger_tables 005_ledger_rpcs 006_budgets 007_savings; do
  psql "dbname=nyofinance_p5_verify" -f supabase/migrations/$f.sql
done
psql "dbname=nyofinance_p5_verify" -f tests/db/verify_savings.sql
```

## 4b. Invarian transaksi Fase 2 (ringkas)

- Uang = BIGINT minor units (IDR: 1 = Rp1); tidak pernah float. Batas
  `1..9007199254740991` untuk amount, `0..MAX` untuk opening.
- Saldo akun diturunkan otoritatif: `opening + income - expense +
  transfer_in - transfer_out` (hanya `posted`).
- Transfer = satu baris atomik (kunci dua akun berurutan, anti-deadlock);
  debit sumber + kredit tujuan → total keluarga tetap (wealth-neutral).
  Transfer akun sama ditolak di UI, RPC, dan constraint.
- Idempotency `(family_id, idempotency_key)` unik; submit ulang dengan
  kunci sama mengembalikan baris lama (UI membuat kunci baru tiap sukses).
- Append-only: UPDATE hanya `posted -> cancelled` (sekali saja, trigger +
  conditional UPDATE); DELETE selalu ditolak.
- RLS: SELECT anggota, INSERT/DELETE langsung diblokir, UPDATE hanya via
  anggota (trigger menegakkan cancel-only); semua tulis lewat RPC
  `SECURITY DEFINER` yang memvalidasi keanggotaan + kepemilikan akun/
  kategori + jenis kategori di batas DB.

## 4c. Invarian anggaran Fase 3 (ringkas)

- Satu anggaran = satu keluarga + satu kategori expense + satu bulan
  (`month` = tanggal hari pertama; unik `(family_id, category_id, month)`).
- Limit = BIGINT minor units `1..9007199254740991`; tidak pernah float.
- Terpakai SELALU diturunkan dari transaksi `posted` jenis `expense` pada
  kategori + bulan itu; transfer, cancelled, income, dan bulan lain
  dikecualikan. Tidak ada kolom terpakai yang disimpan (tanpa balance
  system baru — reuse ledger Fase 2).
- Sisa = limit − terpakai (boleh negatif); persen = integer
  `floor(spent*100/limit)`; status ok (<80%) / warning (≥80%) / over
  (terpakai > limit persis). Over-budget TIDAK memblokir transaksi.
- Kategori income dan kategori milik keluarga lain ditolak di batas DB
  (trigger `enforce_budget_rules`), bukan hanya di RPC.
- Edit hanya limit; `family_id`/`category_id`/`month` immutable (trigger).
  Tidak ada DELETE via API; riwayat bulan lalu dipertahankan + dapat
  dinavigasi (`?bulan=YYYY-MM`).
- RLS: SELECT anggota, INSERT/DELETE langsung diblokir, UPDATE via anggota
  (identitas dikunci trigger); tulis resmi lewat RPC `create_budget` /
  `update_budget_limit`, baca via `get_budget_status` (SECURITY DEFINER,
  validasi keanggotaan).

## 4e. Invarian tujuan tabungan Fase 5 (ringkas)

- Migrasi baru `007_savings.sql` saja (001–006 tidak ditulis ulang):
  tabel `savings_goals` + `goal_contributions`, trigger, RLS, 7 RPC.
- Kontribusi adalah ALOKASI murni, bukan transaksi ledger: tidak menambah
  income, tidak menambah total kekayaan, tidak muncul di laporan
  income/expense (`/reports` tidak membaca tabel kontribusi).
- Uang = BIGINT minor units `1..9007199254740991`; progres integer:
  terkumpul = `sum(posted)` per goal, sisa = target − terkumpul
  (boleh negatif = terlampaui), persen = `floor(terkumpul*100/target)`.
- Append-only seperti transaksi: kontribusi UPDATE hanya
  `posted -> cancelled` (sekali saja, trigger + conditional UPDATE +
  pencatat aktor/waktu); DELETE selalu ditolak; tujuan finished immutable
  kecuali transisi status (`active -> completed|archived`,
  `completed -> archived`; kembali ke active ditolak).
- Idempotency `(family_id, idempotency_key)` unik; submit ulang dengan
  kunci sama mengembalikan baris lama (UI membuat kunci baru tiap sukses).
- `family_id` kontribusi tidak dipercaya dari klien — RPC
  `contribute_to_goal` menurunkannya dari goal server-side; trigger
  `enforce_contribution_rules` menolak family-id campur di batas DB.
- RLS: SELECT anggota, INSERT/DELETE langsung diblokir, UPDATE via anggota
  (trigger mengunci); tulis resmi via RPC `create_goal/update_goal/`
  `complete_goal/archive_goal/contribute_to_goal/cancel_contribution`,
  baca via `get_goal_status` (SECURITY DEFINER, validasi keanggotaan).

## 5e. Alur uji manual Fase 5 (tujuan, butuh login + keluarga)

1. Dari dasbor klik "Kelola tujuan" → `/goals`; kartu kosong
   "Belum ada tujuan tabungan" muncul bila baru.
2. Buat tujuan "Dana darurat" target 1000000 — baris muncul
   0% "Belum mulai"; coba nama sama lagi — ditolak ("sudah dipakai").
3. Setor 200000 + 75000 — progres 27%, sisa 725000; batalkan 75000 —
   kembali 20%; batalkan lagi — ditolak; tidak ada tombol hapus.
4. Cek dasbor: kartu "Tujuan tabungan" menampilkan terkumpul;
   saldo akun + total tidak berubah; `/reports` bulan ini tetap 0
   (tidak double-count).
5. Ubah target/nama selagi active — berubah; "Tandai selesai" →
   status completed; edit target lagi — ditolak; "Arsipkan" →
   archived; setor ke tujuan archived — ditolak.

## 5. Alur uji manual Fase 1 (sesuai 10 kriteria tugas)

1. Buka `/register`, daftar akun A — dialihkan ke `/dashboard`.
2. Buka `/register`, daftar akun B (browser berbeda/incognito).
3. Sebagai A: di dasbor buat keluarga — A menjadi Pemilik.
4. Sebagai A: `/settings/family` — buat tautan undangan — salin.
5. Sebagai B: buka tautan/`/join`, tempel token — B menjadi Anggota.
6. Coba token yang sama lagi — ditolak (sekali pakai).
7. Ubah token satu karakter — ditolak (tidak valid).
8. Buat undangan baru, cabut lalu pakai — ditolak; tombol
   "Cabut" tersedia untuk owner.
9. Sebagai B, coba RPC/insert langsung menjadi owner — ditolak
   (insert langsung diblokir; promosi via UPDATE ditolak trigger).
10. Logout — buka `/dashboard` — dialihkan ke `/login`.

## 5b. Alur uji manual Fase 2 (dasbor, butuh login + keluarga)

1. Di dasbor, tambah akun "Dompet" (saldo awal 100000) dan "Bank" (50000).
2. Tambah kategori "Gaji" (income) dan "Belanja" (expense).
3. Catat pemasukan 50000 ke Dompet/Gaji — saldo Dompet 150000, total 200000.
4. Catat pengeluaran 20000 di Dompet/Belanja — saldo Dompet 130000.
5. Transfer 30000 Dompet → Bank — Dompet 100000, Bank 80000, total tetap.
6. Coba transfer ke akun yang sama — ditolak di UI dan DB.
7. Batalkan satu transaksi — saldo kembali; batalkan lagi — ditolak.
8. Kartu "Arus kas bulan ini" menampilkan income/expense/bersih (transfer
   tidak dihitung sebagai income/expense).
9. Riwayat menampilkan 50 transaksi terbaru beserta status; tidak ada
   tombol hapus permanen (append-only).

## 5c. Alur uji manual Fase 3 (dasbor, butuh login + keluarga + kategori expense)

1. Di dasbor, pastikan ada kategori expense (mis. "Belanja") dan income
   (mis. "Gaji"); kartu "Anggaran bulanan" tampil untuk bulan berjalan.
2. Buat anggaran bulan ini untuk "Belanja" limit 100000 — baris muncul
   dengan terpakai 0, sisa 100000, status ok.
3. Coba buat anggaran yang sama lagi — ditolak ("sudah ada").
4. Coba buat anggaran untuk kategori income "Gaji" — ditolak
   ("hanya untuk kategori pengeluaran").
5. Catat pengeluaran 20000 di "Belanja" bulan ini — terpakai 20000,
   sisa 80000, persen 20%.
6. Catat pengeluaran hingga ≥80% limit — baris menjadi warning
   (bilah kuning); lampaui 100% — menjadi over (bilah merah), tetapi
   transaksi tetap tercatat (tidak diblokir).
7. Batalkan salah satu pengeluaran — terpakai turun kembali.
8. Ubah batas via "Ubah batas" — hanya limit berubah; bulan/kategori tetap.
9. Navigasi bulan (`?bulan=YYYY-MM`, tombol ‹ ›) — anggaran bulan lain
   terpisah; riwayat bulan lalu tetap ada.

## 4d. Invarian laporan Fase 4 (ringkas)

- Tanpa migrasi baru (007 tidak diperlukan): reuse RPC Fase 2
  `get_monthly_summary` + RPC Fase 3 `get_budget_status` + SELECT
  ber-RLS di atas indeks `idx_tx_family_occurred`
  (`family_id, occurred_at DESC, created_at DESC`).
- Uang tetap integer BIGINT minor units; agregasi via `BigInt` di
  `lib/reports.ts` lalu tampil via `formatMinor` — tidak ada float,
  tidak ada sistem saldo kedua.
- Otoritatif = hanya `posted`; `cancelled`/`voided` dikecualikan,
  transfer wealth-neutral (tidak dihitung income/expense).
- MoM integer: delta = current − prev; persen null saat prev = 0
  (tanpa div-zero); persen = integer `(cur−prev)*100/prev` (BigInt).
- Empty state: bulan tanpa transaksi → kartu 0 + pesan "Belum ada
  transaksi posted bulan ini" + bilah kategori kosong.
- Halaman `/reports` memvalidasi semua filter di server
  (`parseReportFilters`: bulan YYYY-MM hari-pertama, enum jenis/status,
  UUID kategori/akun, hal/batas clamp 1..100, tanpa familyId dari klien);
  family selalu dari membership server; RLS `tx_select_member`
  menegakkan isolasi lintas keluarga.
- Ekspor `/reports/export` memakai filter aktif yang sama
  (maks 2000 baris, `text/csv; charset=utf-8`, nama file
  `nyofinance-YYYY-MM.csv`), tanggal ISO, nominal mentah minor units,
  sel CSV disanitasi anti formula-injection (`=+-@` + tab/CR diawali
  `'` + quoting RFC 4180).

## 5d. Alur uji manual Fase 4 (laporan, butuh login + keluarga + transaksi)

1. Dari dasbor klik "Lihat laporan bulanan" → `/reports` bulan berjalan.
2. Kartu ringkasan menampilkan pemasukan/pengeluaran/bersih bulan ini +
   Δ MoM vs bulan lalu; tombol ‹ › + pemilih bulan berpindah
   (`?bulan=YYYY-MM`, halaman daftar reset ke 1).
3. Bagian kategori menampilkan bilah + "5 Teratas" + tabel MoM per
   kategori (bulan ini/lalu/Δ); bulan tanpa expense → pesan kosong.
4. Tabel "Aktual vs anggaran" cocok dengan kartu anggaran dasbor
   (terpakai/sisa/persen); tanpa anggaran → pesan kosong.
5. Filter daftar (kategori/akun/jenis/status/batas) + paginasi ‹ ›
   mempertahankan query; transaksi batal berlabel "Dibatalkan";
   transfer berlabel akun "sumber → tujuan" + kategori "Transfer"
   (tidak dihitung di kartu ringkasan).
6. Klik "Ekspor CSV" → unduh `nyofinance-YYYY-MM.csv` berisi baris
   terfilter yang sama (tanggal ISO, nominal minor mentah);
   sel catatan `=cmd`/dimulai `@/+/-` aman (diawali `'`).

## 6. Checklist verifikasi Cloud dua-akun (manual, belum dieksekusi)
1. **Registrasi + konfirmasi email**
   - A daftar di `/register` (email nyata #1). Jika "Confirm email" aktif,
     verifikasi pesan "periksa email" muncul, klik tautan email -> mendarat
     di `/auth/callback` -> sesi terbentuk -> redirect `/dashboard`.
   - B daftar dengan email nyata #2 di profil browser kedua. Ulangi.
   - Negatif: daftar dengan email sama -> pesan "sudah terdaftar".
2. **Login, logout, callback**
   - Logout A (`logoutAction`) -> buka `/dashboard` -> redirect `/login`.
   - Login kembali dengan kata sandi salah -> pesan generik (tanpa
     membocorkan email terdaftar/tidak).
   - Buka `/auth/callback` tanpa `code` -> redirect `/login`.
   - Buka `/auth/callback?code=x&next=https://evil.example` -> setelah
     gagal/tolak harus tetap di origin aplikasi (tidak ke domain luar).
3. **Pembuatan keluarga**
   - A buat keluarga "Rumah Tangga" (IDR) -> A = Pemilik di dasbor.
   - B buat keluarga sendiri -> B = Pemilik keluarganya.
   - Negatif: A (sudah punya keluarga) panggil `create_family` lagi via
     console -> `Anda sudah tergabung dalam satu keluarga aktif.`
4. **Penerimaan undangan**
   - A buat undangan (72 jam) -> salin tautan sekali tampil.
   - B keluar dari keluarganya dulu (`leaveFamilyAction`), lalu buka
     tautan A -> B menjadi Anggota keluarga A.
5. **Undangan invalid / kedaluwarsa / dipakai ulang**
   - Tempel token yang diubah 1 karakter -> "tidak valid".
   - Pakai token yang sama kedua kali -> "sudah dipakai".
   - Cabut undangan baru via tombol Cabut lalu pakai -> "tidak valid".
   - (Butuh akses SQL/owner) buat undangan, majukan `expires_at` ke masa
     lalu, lalu pakai -> "kedaluwarsa".
6. **Penolakan lintas-keluarga**
   - B (anggota A) query `families` keluarga lain via console ->
     tidak terlihat (RLS `is_family_member`).
   - B panggil `list_family_invites(family_id_orang_lain)` -> kosong/gagal.
   - B panggil `create_family_invite` untuk keluarga orang lain ->
     `Hanya pemilik keluarga...`.
7. **Perubahan peran tak sah**
   - B `update family_members set role='owner'` miliknya -> ditolak
     (policy + trigger `membership identity is immutable`).
   - B `update` baris milik A -> ditolak (policy `user_id = auth.uid()`).
   - B `insert` langsung ke `family_members` sebagai owner -> ditolak.
8. **RPC tak sah langsung**
   - Tanpa login: panggil `create_family` / `accept_family_invite` ->
     `Sesi berakhir / not authenticated`.
   - B (anggota) panggil `revoke_family_invite` milik A -> ditolak owner.
   - Panggil `accept_family_invite` dengan hash non-hex -> `invalid invite`.
9. **Sesi kedaluwarsa + rute proteksi**
   - Hapus cookie sesi / tunggu kedaluwarsa -> buka `/dashboard`,
     `/settings/family`, `/join` -> semua redirect `/login`.
   - Buka `/` saat logout -> tampil landing publik (tanpa data keluarga).
10. **Kebocoran rahasia**
    - Selama semua langkah: tidak ada token undangan mentah di log server,
      tidak ada `service_role` di bundle browser (cari di Sources),
      `token_hash` tidak pernah muncul di respons `list_family_invites`
      maupun query tabel langsung.

## Struktur proyek

- `app/` — rute (`/`, `/login`, `/register`, `/dashboard`,
  `/settings/family`, `/join`, `/auth/callback`, `/reports` +
  `/reports/export` CSV, `/goals`) + server actions
- `components/` — UI bersama (form auth, kartu keluarga, form gabung,
  ledger, anggaran, laporan, tujuan)
- `lib/` — klien Supabase server/browser, util undangan, validasi, tipe DB,
  uang minor-unit, laporan (`reports.ts`), tujuan (`savings.ts`)
- `supabase/migrations/` — `001_core.sql`, `002_invites.sql`, `003_rls.sql`,
  `004_ledger_tables.sql`, `005_ledger_rpcs.sql`, `006_budgets.sql`,
  `007_savings.sql`
- `tests/` — `unit.test.ts` (vitest: 42 uji),
  `db/verify_policies.sql`, `db/verify_ledger.sql`,
  `db/verify_budgets.sql`, `db/verify_reports.sql`, `db/verify_savings.sql`
- `proxy.ts` — penyegar sesi Supabase (pengganti middleware di Next 16)

## Keamanan (ringkas)

- RLS aktif di semua tabel; tanpa policy SELECT, baca ditolak.
- `token_hash` undangan tidak pernah terbaca via API.
- Pembuatan keluarga dan join hanya lewat RPC `SECURITY DEFINER`
  bervalidasi server (atomik, row-lock, cek kedaluwarsa/pakai/cabut).
- Insert langsung ke `families`/`family_members`/`family_invitations`
  ditolak policy (`WITH CHECK (false)`).
- Promosi diri (`role` menjadi owner) ditolak trigger `lock_membership_identity`.
- Fungsi memakai `SET search_path = public, pg_temp` + nama objek
  terkualifikasi + grant EXECUTE minimal.
