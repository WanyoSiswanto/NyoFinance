"use server";

import { createClient } from "@/lib/supabase/server";
import { generateIdempotencyKey } from "@/lib/money";
import {
  validateContributionAmount,
  validateGoalDescription,
  validateGoalName,
  validateGoalTarget,
  validateGoalTargetDate,
  validateIdempotencyKey,
  validateNote,
  validateOccurredDate,
} from "@/lib/validation";

export type SavingsResult = {
  ok?: boolean;
  error?: string;
  id?: string;
};

async function requireSession() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { supabase: null };
  return { supabase };
}

function savingsMessage(error: { code?: string; message: string }): string | null {
  const msg = error.message;
  if (/not authenticated/i.test(msg)) return "Sesi berakhir. Silakan masuk kembali.";
  if (/not family member/i.test(msg)) return "Anda bukan anggota keluarga ini.";
  if (/duplicate goal/i.test(msg)) return "Nama tujuan sudah dipakai di keluarga ini.";
  if (/goal is archived/i.test(msg)) return "Tujuan sudah diarsipkan dan tidak bisa menerima setoran.";
  if (/invalid goal status transition/i.test(msg)) return "Status tujuan tidak bisa diubah seperti itu.";
  if (/finished goal is immutable/i.test(msg)) return "Tujuan yang sudah selesai hanya bisa diarsipkan.";
  if (/already cancelled/i.test(msg)) return "Setoran sudah dibatalkan.";
  if (/cancelled contribution is final/i.test(msg)) return "Setoran yang dibatalkan bersifat final.";
  if (/invalid goal (name|target|description)/i.test(msg)) return "Data tujuan tidak valid.";
  if (/goal not found|contribution not found/i.test(msg)) return "Data tidak ditemukan.";
  if (/goal family mismatch/i.test(msg)) return "Tujuan bukan milik keluarga ini.";
  return null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createGoalAction(input: {
  familyId: string;
  name: string;
  description?: string | null;
  targetMinor: number;
  targetDateInput?: string | null;
}): Promise<SavingsResult> {
  const nameErr = validateGoalName(input.name);
  if (nameErr) return { error: nameErr };
  const descErr = validateGoalDescription(input.description);
  if (descErr) return { error: descErr };
  const targetErr = validateGoalTarget(input.targetMinor);
  if (targetErr) return { error: targetErr };
  const parsed = validateGoalTargetDate(input.targetDateInput);
  if ("error" in parsed) return { error: parsed.error };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("create_goal", {
    p_family_id: input.familyId,
    p_name: input.name.trim(),
    p_description: input.description?.trim() ? input.description.trim() : null,
    p_target_minor: input.targetMinor,
    p_target_date: parsed.date,
  });
  if (error) return { error: savingsMessage(error) ?? "Gagal membuat tujuan." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function updateGoalAction(input: {
  goalId: string;
  name: string;
  description?: string | null;
  targetMinor: number;
  targetDateInput?: string | null;
}): Promise<SavingsResult> {
  const nameErr = validateGoalName(input.name);
  if (nameErr) return { error: nameErr };
  const descErr = validateGoalDescription(input.description);
  if (descErr) return { error: descErr };
  const targetErr = validateGoalTarget(input.targetMinor);
  if (targetErr) return { error: targetErr };
  const parsed = validateGoalTargetDate(input.targetDateInput);
  if ("error" in parsed) return { error: parsed.error };
  if (!input.goalId) return { error: "ID tujuan wajib diisi." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("update_goal", {
    p_goal_id: input.goalId,
    p_name: input.name.trim(),
    p_description: input.description?.trim() ? input.description.trim() : null,
    p_target_minor: input.targetMinor,
    p_target_date: parsed.date,
  });
  if (error) return { error: savingsMessage(error) ?? "Gagal mengubah tujuan." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function completeGoalAction(input: {
  goalId: string;
}): Promise<SavingsResult> {
  if (!input.goalId) return { error: "ID tujuan wajib diisi." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("complete_goal", {
    p_goal_id: input.goalId,
  });
  if (error) return { error: savingsMessage(error) ?? "Gagal menyelesaikan tujuan." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function archiveGoalAction(input: {
  goalId: string;
}): Promise<SavingsResult> {
  if (!input.goalId) return { error: "ID tujuan wajib diisi." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("archive_goal", {
    p_goal_id: input.goalId,
  });
  if (error) return { error: savingsMessage(error) ?? "Gagal mengarsipkan tujuan." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function contributeToGoalAction(input: {
  goalId: string;
  amountMinor: number;
  note?: string | null;
  occurredAt?: string;
  idempotencyKey?: string;
}): Promise<SavingsResult> {
  const a = validateContributionAmount(input.amountMinor);
  if (a) return { error: a };
  const n = validateNote(input.note);
  if (n) return { error: n };
  const d = validateOccurredDate(input.occurredAt ?? todayIso());
  if (d) return { error: d };
  const key = input.idempotencyKey?.trim() || generateIdempotencyKey();
  const k = validateIdempotencyKey(key);
  if (k) return { error: k };
  if (!input.goalId) return { error: "Tujuan wajib dipilih." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("contribute_to_goal", {
    p_goal_id: input.goalId,
    p_amount_minor: input.amountMinor,
    p_note: input.note?.trim() ? input.note.trim() : null,
    p_occurred_at: input.occurredAt ?? todayIso(),
    p_idempotency_key: key,
  });
  if (error) return { error: savingsMessage(error) ?? "Gagal mencatat setoran." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function cancelContributionAction(input: {
  contributionId: string;
}): Promise<SavingsResult> {
  if (!input.contributionId) return { error: "ID setoran wajib diisi." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("cancel_contribution", {
    p_contribution_id: input.contributionId,
  });
  if (error) return { error: savingsMessage(error) ?? "Gagal membatalkan setoran." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}
