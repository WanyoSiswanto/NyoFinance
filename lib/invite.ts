import { createHash, randomBytes } from "node:crypto";

/**
 * Util undangan keluarga.
 * - Token mentah dibuat acak (32 byte) di server dan hanya ditampilkan sekali.
 * - Yang disimpan di database adalah hash SHA-256, bukan token mentah.
 * - Token kedaluwarsa dan sekali pakai (ditegakkan di database via RPC).
 */

export const INVITE_TOKEN_BYTES = 32;
export const INVITE_DEFAULT_EXPIRY_HOURS = 72;
export const INVITE_MAX_EXPIRY_HOURS = 168; // 7 hari
export const INVITE_TOKEN_HASH_RE = /^[0-9a-f]{64}$/;

/** Buat token undangan acak (base64url, 43 karakter). Hanya dipanggil di server. */
export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

/** Hash SHA-256 (hex) dari token mentah untuk disimpan di database. */
export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** Validasi format hash token (64 hex lowercase). */
export function isValidTokenHashFormat(hash: string): boolean {
  return INVITE_TOKEN_HASH_RE.test(hash);
}

/** Hitung waktu kedaluwarsa undangan. */
export function computeInviteExpiry(
  hours: number = INVITE_DEFAULT_EXPIRY_HOURS,
  from: Date = new Date(),
): Date {
  const safeHours = Number.isFinite(hours) ? hours : INVITE_DEFAULT_EXPIRY_HOURS;
  const clamped = Math.min(
    Math.max(safeHours, 1),
    INVITE_MAX_EXPIRY_HOURS,
  );
  return new Date(from.getTime() + clamped * 3_600_000);
}

/** True jika undangan sudah kedaluwarsa. */
export function isInviteExpired(
  expiresAt: string | Date,
  now: Date = new Date(),
): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

/** Rapikan input token dari pengguna tanpa pernah mencatatnya ke log. */
export function normalizeInviteToken(input: string): string {
  return input.trim().replace(/\s+/g, "");
}
