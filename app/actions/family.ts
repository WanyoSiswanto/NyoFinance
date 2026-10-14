"use server";

import { createClient } from "@/lib/supabase/server";
import {
  generateInviteToken,
  hashInviteToken,
  normalizeInviteToken,
} from "@/lib/invite";
import {
  normalizeCurrency,
  validateCurrency,
  validateFamilyName,
  validateFullName,
} from "@/lib/validation";

export type FamilyResult = {
  ok?: boolean;
  error?: string;
  familyId?: string;
};

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

async function requireSession() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { supabase: null, userId: null as string | null };
  return { supabase, userId: data.user.id as string };
}

function rpcMessage(error: { code?: string; message: string }): string | null {
  const msg = error.message;
  if (error.code === "23505" || /already in a family/i.test(msg))
    return "Anda sudah tergabung dalam satu keluarga aktif.";
  if (error.code === "42501" || /not family owner/i.test(msg))
    return "Hanya pemilik keluarga yang dapat melakukan tindakan ini.";
  if (/expired or already used|invalid invite/i.test(msg))
    return "Undangan tidak valid, kedaluwarsa, atau sudah dipakai.";
  if (/not authenticated/i.test(msg))
    return "Sesi berakhir. Silakan masuk kembali.";
  return null;
}

/** Buat workspace keluarga; pembuat otomatis menjadi owner (atomik via RPC). */
export async function createFamilyAction(input: {
  name: string;
  currency: string;
}): Promise<FamilyResult> {
  const nameErr = validateFamilyName(input.name);
  if (nameErr) return { error: nameErr };
  const currency = normalizeCurrency(input.currency || "IDR");
  const curErr = validateCurrency(currency);
  if (curErr) return { error: curErr };

  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };

  const { data, error } = await supabase.rpc("create_family", {
    p_name: input.name.trim(),
    p_currency: currency,
  });
  if (error) {
    return { error: rpcMessage(error) ?? "Gagal membuat keluarga. Silakan coba lagi." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, familyId: row.id };
}

/**
 * Buat undangan (hanya owner). Token mentah dibuat di server, hash-nya yang
 * disimpan. Token mentah dikembalikan SEKALI untuk dibagikan — tidak dicatat.
 */
export async function createInviteAction(input: {
  familyId: string;
  hours?: number;
}): Promise<
  FamilyResult & { token?: string; joinUrl?: string; expiresAt?: string; inviteId?: string }
> {
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };

  const hours = Math.min(Math.max(Math.floor(input.hours ?? 72), 1), 168);
  const token = generateInviteToken();

  const { data, error } = await supabase.rpc("create_family_invite", {
    p_family_id: input.familyId,
    p_token_hash: hashInviteToken(token),
    p_expires_in_hours: hours,
  });
  if (error) {
    return { error: rpcMessage(error) ?? "Gagal membuat undangan. Silakan coba lagi." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    id: string;
    expires_at: string;
  };
  return {
    ok: true,
    token,
    inviteId: row.id,
    expiresAt: row.expires_at,
    joinUrl: `${siteUrl()}/join?token=${token}`,
  };
}

/** Cabut undangan (hanya owner). */
export async function revokeInviteAction(input: {
  inviteId: string;
}): Promise<FamilyResult> {
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };

  const { error } = await supabase.rpc("revoke_family_invite", {
    p_invite_id: input.inviteId,
  });
  if (error) {
    return { error: rpcMessage(error) ?? "Gagal mencabut undangan. Silakan coba lagi." };
  }
  return { ok: true };
}

/**
 * Terima undangan dengan token mentah. Divalidasi server-side & atomik via RPC:
 * menolak token kedaluwarsa / dipakai / dicabut / tak dikenal.
 */
export async function acceptInviteAction(input: {
  token: string;
}): Promise<FamilyResult> {
  const raw = normalizeInviteToken(input.token);
  if (!raw) return { error: "Masukkan kode undangan." };

  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };

  const { data, error } = await supabase.rpc("accept_family_invite", {
    p_token_hash: hashInviteToken(raw),
  });
  if (error) {
    return { error: rpcMessage(error) ?? "Gagal memakai undangan. Silakan coba lagi." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { family_id: string };
  return { ok: true, familyId: row.family_id };
}

/** Keluar dari keluarga (nonaktifkan keanggotaan sendiri). */
export async function leaveFamilyAction(): Promise<FamilyResult> {
  const { supabase, userId } = await requireSession();
  if (!supabase || !userId)
    return { error: "Sesi berakhir. Silakan masuk kembali." };

  const { data: membership, error: fetchError } = await supabase
    .from("family_members")
    .select("family_id,user_id,role,status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (fetchError || !membership) {
    return { error: "Anda tidak tergabung dalam keluarga aktif." };
  }
  const { error } = await supabase
    .from("family_members")
    .update({ status: "inactive" })
    .eq("family_id", (membership as { family_id: string }).family_id)
    .eq("user_id", userId);
  if (error) {
    return { error: "Gagal keluar dari keluarga. Silakan coba lagi." };
  }
  return { ok: true };
}

/** Perbarui nama lengkap profil sendiri. */
export async function updateProfileAction(input: {
  fullName: string;
}): Promise<FamilyResult> {
  const nameErr = validateFullName(input.fullName);
  if (nameErr) return { error: nameErr };
  const { supabase, userId } = await requireSession();
  if (!supabase || !userId)
    return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: input.fullName.trim() })
    .eq("id", userId);
  if (error) return { error: "Gagal memperbarui profil. Silakan coba lagi." };
  return { ok: true };
}
