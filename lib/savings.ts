/** Util tujuan tabungan Fase 5: progres alokasi integer murni.
 * Kontribusi adalah ALOKASI, bukan transaksi ledger: tidak menambah income,
 * tidak menambah total kekayaan, tidak muncul di laporan income/expense.
 * Semua nominal BIGINT minor-unit; persen memakai aritmetika integer.
 */

export const GOAL_NAME_MAX = 80;
export const GOAL_DESC_MAX = 500;

export type GoalStatusKind = "active" | "completed" | "archived";

/** Sisa target: target - terkumpul (boleh negatif = terlampaui). BigInt. */
export function goalRemaining(target: number, allocated: number): number {
  return Number(BigInt(target) - BigInt(allocated));
}

/**
 * Persen progres integer: floor(allocated*100/target).
 * target <= 0 atau allocated <= 0 -> 0. Boleh > 100 (terlampaui).
 */
export function goalProgressPercent(target: number, allocated: number): number {
  if (target <= 0 || allocated <= 0) return 0;
  return Number((BigInt(allocated) * BigInt(100)) / BigInt(target));
}

/** Status progres untuk tampilan: belum-mulai / berjalan / tercapai / terlampaui. */
export function goalProgressLabel(
  target: number,
  allocated: number,
): "belum-mulai" | "berjalan" | "tercapai" | "terlampaui" {
  if (allocated <= 0) return "belum-mulai";
  if (allocated < target) return "berjalan";
  if (allocated === target) return "tercapai";
  return "terlampaui";
}

/** Jumlah posted kontribusi -> total alokasi (BigInt, tolak cancelled). */
export function sumPostedContributions(
  rows: { status: string; amount_minor: number }[],
): number {
  let total = BigInt(0);
  for (const r of rows) {
    if (r.status !== "posted") continue;
    total += BigInt(r.amount_minor);
  }
  if (total > BigInt(9_007_199_254_740_991))
    throw new Error("sum out of range");
  return Number(total);
}

/**
 * Estimasi iuran bulanan agar mencapai target tepat waktu (ceil integer).
 * remaining <= 0 -> 0 (sudah tercapai). monthsLeft <= 0 -> remaining
 * (jatuh tempo tiba/lewat: butuh sekaligus). target tanpa tanggal -> null.
 */
export function estimatedMonthlyContribution(
  remaining: number,
  monthsLeft: number | null,
): number | null {
  if (monthsLeft === null) return null;
  if (remaining <= 0) return 0;
  if (monthsLeft <= 0) return remaining;
  const r = BigInt(remaining);
  const m = BigInt(monthsLeft);
  return Number((r + m - BigInt(1)) / m);
}

/**
 * Sisa bulan kalender dari hari ini (UTC) sampai target (inklusif target).
 * target null -> null. Format YYYY-MM-DD. Batas 2000..2100.
 */
export function monthsLeftToTarget(
  targetDateIso: string | null,
  todayIso?: string,
): number | null {
  if (targetDateIso === null || targetDateIso === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDateIso)) return null;
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  const gy = Number(targetDateIso.slice(0, 4));
  const gm = Number(targetDateIso.slice(5, 7));
  if (
    ty < 2000 || ty > 2100 || gy < 2000 || gy > 2100 ||
    tm < 1 || tm > 12 || gm < 1 || gm > 12
  )
    return null;
  const diff = (gy - ty) * 12 + (gm - tm);
  // Beda bulan kalender; hari dalam bulan diabaikan (estimasi kasar).
  // Target bulan ini -> 1 (jatuh tempo bulan berjalan).
  if (targetDateIso < today) return 0;
  return diff + 1;
}
