"use server";

import { createClient } from "@/lib/supabase/server";
import { validateBudgetLimit, validateBudgetMonth } from "@/lib/validation";

export type BudgetResult = {
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

function budgetMessage(error: { code?: string; message: string }): string | null {
  const msg = error.message;
  if (/not authenticated/i.test(msg)) return "Sesi berakhir. Silakan masuk kembali.";
  if (/not family member/i.test(msg)) return "Anda bukan anggota keluarga ini.";
  if (/duplicate budget/i.test(msg)) return "Anggaran untuk kategori dan bulan ini sudah ada.";
  if (/income category not allowed/i.test(msg))
    return "Anggaran hanya untuk kategori pengeluaran.";
  if (/invalid budget limit/i.test(msg)) return "Batas anggaran tidak valid.";
  if (/invalid month/i.test(msg)) return "Bulan anggaran tidak valid.";
  if (/category family mismatch/i.test(msg)) return "Kategori bukan milik keluarga ini.";
  if (/category not found|budget not found/i.test(msg)) return "Data tidak ditemukan.";
  return null;
}

function splitMonth(firstDay: string): { year: number; month: number } {
  return {
    year: Number(firstDay.slice(0, 4)),
    month: Number(firstDay.slice(5, 7)),
  };
}

export async function createBudgetAction(input: {
  familyId: string;
  categoryId: string;
  monthInput: string;
  limitMinor: number;
}): Promise<BudgetResult> {
  const limitErr = validateBudgetLimit(input.limitMinor);
  if (limitErr) return { error: limitErr };
  const parsed = validateBudgetMonth(input.monthInput);
  if ("error" in parsed) return { error: parsed.error };
  if (!input.categoryId) return { error: "Kategori wajib dipilih." };
  const { year, month } = splitMonth(parsed.firstDay);
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("create_budget", {
    p_family_id: input.familyId,
    p_category_id: input.categoryId,
    p_year: year,
    p_month: month,
    p_limit_minor: input.limitMinor,
  });
  if (error) return { error: budgetMessage(error) ?? "Gagal membuat anggaran." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function updateBudgetLimitAction(input: {
  budgetId: string;
  limitMinor: number;
}): Promise<BudgetResult> {
  const limitErr = validateBudgetLimit(input.limitMinor);
  if (limitErr) return { error: limitErr };
  if (!input.budgetId) return { error: "ID anggaran wajib diisi." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("update_budget_limit", {
    p_budget_id: input.budgetId,
    p_limit_minor: input.limitMinor,
  });
  if (error) return { error: budgetMessage(error) ?? "Gagal mengubah anggaran." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}
