/** Util uang minor-unit Fase 2. Tidak memakai float untuk uang. */

export const MAX_SAFE_MINOR = 9_007_199_254_740_991;
export const MIN_DATE_ISO = "2000-01-01";

export function isValidAmountMinor(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= 1 &&
    n <= MAX_SAFE_MINOR
  );
}

export function isValidOpeningMinor(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isInteger(n) &&
    n >= 0 &&
    n <= MAX_SAFE_MINOR
  );
}

/**
 * Parse input pengguna (mis. "1.500.000", "Rp 25000", "25000") menjadi minor.
 * Hanya memakai digit (aritmetika integer) — tidak memakai parseFloat.
 */
export function parseMinorInput(raw: string): number | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits || digits.length > 16) return null;
  const stripped = digits.replace(/^0+(?=\d)/, "");
  const n = Number.parseInt(stripped || "0", 10);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

export function formatMinor(minor: number, currency = "IDR"): string {
  const safe = Number.isInteger(minor) ? minor : 0;
  try {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(safe);
  } catch {
    return `${currency} ${safe.toLocaleString("id-ID")}`;
  }
}

/** Saldo akun: opening + income - expense + transferIn - transferOut (BigInt). */
export function computeAccountBalance(args: {
  opening: number;
  income: number;
  expense: number;
  transferIn: number;
  transferOut: number;
}): number {
  const r =
    BigInt(args.opening) +
    BigInt(args.income) -
    BigInt(args.expense) +
    BigInt(args.transferIn) -
    BigInt(args.transferOut);
  if (r > BigInt(MAX_SAFE_MINOR) || r < BigInt(-MAX_SAFE_MINOR)) {
    throw new Error("balance out of range");
  }
  return Number(r);
}

export function sumMinors(values: number[]): number {
  let total = BigInt(0);
  for (const v of values) total += BigInt(v);
  if (total > BigInt(MAX_SAFE_MINOR)) throw new Error("sum out of range");
  return Number(total);
}

export function monthlyNet(income: number, expense: number): number {
  return Number(BigInt(income) - BigInt(expense));
}

/** Sisa anggaran: limit - terpakai (boleh negatif = terlampaui). BigInt. */
export function budgetRemaining(limit: number, spent: number): number {
  return Number(BigInt(limit) - BigInt(spent));
}

/**
 * Persentase pemakaian anggaran dalam bilangan bulat (mis. 80 = 80%).
 * Dihitung dengan aritmetika integer: floor(spent*100/limit).
 * limit <= 0 atau input negatif -> 0 (tak terdefinisi, bukan NaN float).
 */
export function budgetUsagePercent(limit: number, spent: number): number {
  if (limit <= 0 || spent <= 0) return 0;
  return Number((BigInt(spent) * BigInt(100)) / BigInt(limit));
}

/** Status anggaran: ok (<80%), warning (80–100%), over (>100% persis). */
export function budgetStatus(
  limit: number,
  spent: number,
): "ok" | "warning" | "over" {
  // Bandingkan minor-unit persis (bukan persen floor) agar overspend
  // di bawah 1% (mis. 1001/1000) tetap terdeteksi sebagai over.
  if (spent > limit) return "over";
  if (budgetUsagePercent(limit, spent) >= 80) return "warning";
  return "ok";
}

/** Normalisasi bulan ke hari pertama ("2026-10" / "2026-10-15" -> "2026-10-01"). */
export function firstDayOfMonthIso(input: string): string | null {
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(input.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** Geser bulan ("2026-10-01", -1 -> "2026-09-01"). Murni string/date integer. */
export function shiftMonthIso(firstDayIso: string, delta: number): string | null {
  if (!/^\d{4}-\d{2}-01$/.test(firstDayIso)) return null;
  const [y, mo] = firstDayIso.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1));
  const yy = d.getUTCFullYear();
  if (yy < 2000 || yy > 2100) return null;
  return `${yy}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Label Indonesia: "2026-10-01" -> "Oktober 2026". */
export function monthLabelId(firstDayIso: string): string {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const m = /^(\d{4})-(\d{2})-01$/.exec(firstDayIso);
  if (!m) return firstDayIso;
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** Kunci idempotency: 21 char [A-Za-z0-9_-]. */
export function generateIdempotencyKey(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const bytes = new Uint8Array(21);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % 64];
  return out;
}
