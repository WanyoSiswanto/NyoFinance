/** Validasi input di server (dan dipakai ulang di client untuk UX). */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateEmail(email: string): string | null {
  if (!email || !EMAIL_RE.test(email.trim())) return "Masukkan alamat email yang valid.";
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password || password.length < 8)
    return "Kata sandi minimal 8 karakter.";
  if (password.length > 128) return "Kata sandi terlalu panjang.";
  return null;
}

export function validateFullName(name: string): string | null {
  const v = name.trim();
  if (v.length < 2) return "Nama lengkap minimal 2 karakter.";
  if (v.length > 120) return "Nama lengkap maksimal 120 karakter.";
  return null;
}

export function validateFamilyName(name: string): string | null {
  const v = name.trim();
  if (v.length < 2) return "Nama keluarga minimal 2 karakter.";
  if (v.length > 80) return "Nama keluarga maksimal 80 karakter.";
  return null;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function validateCurrency(currency: string): string | null {
  const v = currency.trim().toUpperCase();
  if (!CURRENCY_RE.test(v)) return "Kode mata uang harus 3 huruf (mis. IDR).";
  return null;
}

export function normalizeCurrency(currency: string): string {
  return currency.trim().toUpperCase();
}

export function validateAccountName(name: string): string | null {
  const v = name.trim();
  if (v.length < 1) return "Nama akun minimal 1 karakter.";
  if (v.length > 80) return "Nama akun maksimal 80 karakter.";
  return null;
}

export function validateCategoryName(name: string): string | null {
  const v = name.trim();
  if (v.length < 1) return "Nama kategori minimal 1 karakter.";
  if (v.length > 80) return "Nama kategori maksimal 80 karakter.";
  return null;
}

export function validateCategoryKind(kind: string): string | null {
  const v = kind.trim().toLowerCase();
  if (v !== "income" && v !== "expense") return "Jenis kategori harus income atau expense.";
  return null;
}

export function validateAmountMinor(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 9_007_199_254_740_991)
    return "Nominal harus bilangan bulat 1..9007199254740991.";
  return null;
}

export function validateOpeningMinor(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 9_007_199_254_740_991)
    return "Saldo awal harus bilangan bulat 0..9007199254740991.";
  return null;
}

export function validateNote(note: string | null | undefined): string | null {
  if (note == null || note === "") return null;
  if (note.trim().length === 0) return null;
  if (note.length > 500) return "Catatan maksimal 500 karakter.";
  return null;
}

const IDEM_RE = /^[A-Za-z0-9_-]+$/;

export function validateIdempotencyKey(key: string): string | null {
  const v = key.trim();
  if (v.length < 1 || v.length > 80 || !IDEM_RE.test(v))
    return "Kunci idempotency harus 1-80 karakter [A-Za-z0-9_-].";
  return null;
}

export function validateOccurredDate(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "Tanggal harus format YYYY-MM-DD.";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "Tanggal tidak valid.";
  // Tolak tanggal kalender fiktif (mis. 2026-02-30): JS me-roll-over ke
  // bulan berikutnya alih-alih NaN — samakan dengan validateGoalTargetDate.
  if (d.toISOString().slice(0, 10) !== iso) return "Tanggal tidak valid.";
  if (iso < "2000-01-01") return "Tanggal minimal 2000-01-01.";
  const now = new Date();
  const max = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  max.setUTCDate(max.getUTCDate() + 365);
  const maxIso = max.toISOString().slice(0, 10);
  if (iso > maxIso) return "Tanggal maksimal 1 tahun ke depan.";
  return null;
}

/** Batas anggaran: bilangan bulat 1..MAX_SAFE (sama seperti amount). */
export function validateBudgetLimit(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 9_007_199_254_740_991)
    return "Batas anggaran harus bilangan bulat 1..9007199254740991.";
  return null;
}

/**
 * Bulan anggaran: "YYYY-MM" (atau "YYYY-MM-01" yang dinormalisasi).
 * Rentang 2000-01 .. 2100-12. Mengembalikan hari pertama atau pesan error.
 */
export function validateBudgetMonth(input: string): { firstDay: string } | { error: string } {
  const t = input.trim();
  const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(t);
  if (!m) return { error: "Bulan harus format YYYY-MM." };
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12)
    return { error: "Bulan harus antara 2000-01 dan 2100-12." };
  return { firstDay: `${m[1]}-${m[2]}-01` };
}

/** Nama tujuan tabungan: 1..80 karakter setelah trim. */
export function validateGoalName(name: string): string | null {
  const v = name.trim();
  if (v.length < 1) return "Nama tujuan minimal 1 karakter.";
  if (v.length > 80) return "Nama tujuan maksimal 80 karakter.";
  return null;
}

/** Deskripsi tujuan: opsional, maksimal 500 karakter. */
export function validateGoalDescription(desc: string | null | undefined): string | null {
  if (desc == null || desc === "") return null;
  if (desc.length > 500) return "Deskripsi tujuan maksimal 500 karakter.";
  return null;
}

/**
 * Target tabungan: bilangan bulat 1..MAX_SAFE.
 * Nol tidak diizinkan agar persen progres selalu terdefinisi.
 */
export function validateGoalTarget(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 9_007_199_254_740_991)
    return "Target tabungan harus bilangan bulat 1..9007199254740991.";
  return null;
}

/**
 * Tanggal target: opsional "YYYY-MM-DD", rentang 2000-01-01..2100-12-31.
 * Mengembalikan ISO atau pesan error; string kosong berarti tanpa target.
 */
export function validateGoalTargetDate(input: string | null | undefined): { date: string | null } | { error: string } {
  if (input == null || input.trim() === "") return { date: null };
  const t = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return { error: "Tanggal target harus format YYYY-MM-DD." };
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t)
    return { error: "Tanggal target tidak valid." };
  if (t < "2000-01-01" || t > "2100-12-31")
    return { error: "Tanggal target harus antara 2000-01-01 dan 2100-12-31." };
  return { date: t };
}

/** Setoran alokasi: bilangan bulat 1..MAX_SAFE (bukan transaksi ledger). */
export function validateContributionAmount(n: unknown): string | null {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 9_007_199_254_740_991)
    return "Nominal setoran harus bilangan bulat 1..9007199254740991.";
  return null;
}
