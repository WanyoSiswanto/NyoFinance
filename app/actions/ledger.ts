"use server";

import { createClient } from "@/lib/supabase/server";
import { generateIdempotencyKey } from "@/lib/money";
import {
  validateAccountName,
  validateAmountMinor,
  validateCategoryKind,
  validateCategoryName,
  validateIdempotencyKey,
  validateNote,
  validateOccurredDate,
  validateOpeningMinor,
} from "@/lib/validation";

export type LedgerResult = {
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

function ledgerMessage(error: { code?: string; message: string }): string | null {
  const msg = error.message;
  if (/not authenticated/i.test(msg)) return "Sesi berakhir. Silakan masuk kembali.";
  if (/not family member/i.test(msg)) return "Anda bukan anggota keluarga ini.";
  if (/same account transfer/i.test(msg)) return "Transfer harus ke akun yang berbeda.";
  if (/already cancelled/i.test(msg)) return "Transaksi sudah dibatalkan.";
  if (/duplicate account name/i.test(msg)) return "Nama akun sudah dipakai di keluarga ini.";
  if (/duplicate category name/i.test(msg)) return "Nama kategori sudah dipakai di keluarga ini.";
  if (/invalid amount/i.test(msg)) return "Nominal tidak valid.";
  if (/invalid opening balance/i.test(msg)) return "Saldo awal tidak valid.";
  if (/invalid (note|date|idempotency key|month)/i.test(msg)) return "Input transaksi tidak valid.";
  if (/account family mismatch|category family mismatch/i.test(msg))
    return "Akun atau kategori bukan milik keluarga ini.";
  if (/category kind mismatch/i.test(msg)) return "Jenis kategori tidak sesuai transaksi.";
  if (/account not found|category not found|transaction not found|source account not found|dest account not found/i.test(msg))
    return "Data tidak ditemukan.";
  return null;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createAccountAction(input: {
  familyId: string;
  name: string;
  openingMinor: number;
}): Promise<LedgerResult> {
  const nameErr = validateAccountName(input.name);
  if (nameErr) return { error: nameErr };
  const openErr = validateOpeningMinor(input.openingMinor);
  if (openErr) return { error: openErr };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("create_account", {
    p_family_id: input.familyId,
    p_name: input.name.trim(),
    p_opening_balance_minor: input.openingMinor,
  });
  if (error) return { error: ledgerMessage(error) ?? "Gagal membuat akun." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function createCategoryAction(input: {
  familyId: string;
  name: string;
  kind: string;
}): Promise<LedgerResult> {
  const nameErr = validateCategoryName(input.name);
  if (nameErr) return { error: nameErr };
  const kindErr = validateCategoryKind(input.kind);
  if (kindErr) return { error: kindErr };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("create_category", {
    p_family_id: input.familyId,
    p_name: input.name.trim(),
    p_kind: input.kind.trim().toLowerCase(),
  });
  if (error) return { error: ledgerMessage(error) ?? "Gagal membuat kategori." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

type PostBase = {
  familyId: string;
  amountMinor: number;
  note?: string | null;
  occurredAt?: string;
  idempotencyKey?: string;
};

function validatePostBase(input: PostBase): string | null {
  const a = validateAmountMinor(input.amountMinor);
  if (a) return a;
  const n = validateNote(input.note);
  if (n) return n;
  const d = validateOccurredDate(input.occurredAt ?? todayIso());
  if (d) return d;
  const key = input.idempotencyKey?.trim() || generateIdempotencyKey();
  const k = validateIdempotencyKey(key);
  if (k) return k;
  return null;
}

function postArgs(input: PostBase) {
  return {
    p_family_id: input.familyId,
    p_amount_minor: input.amountMinor,
    p_note: input.note?.trim() ? input.note.trim() : null,
    p_occurred_at: input.occurredAt ?? todayIso(),
    p_idempotency_key: input.idempotencyKey?.trim() || generateIdempotencyKey(),
  };
}

export async function postIncomeAction(
  input: PostBase & { accountId: string; categoryId: string },
): Promise<LedgerResult> {
  const err = validatePostBase(input);
  if (err) return { error: err };
  if (!input.accountId || !input.categoryId) return { error: "Akun dan kategori wajib diisi." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("post_income", {
    ...postArgs(input),
    p_account_id: input.accountId,
    p_category_id: input.categoryId,
  });
  if (error) return { error: ledgerMessage(error) ?? "Gagal mencatat pemasukan." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function postExpenseAction(
  input: PostBase & { accountId: string; categoryId: string },
): Promise<LedgerResult> {
  const err = validatePostBase(input);
  if (err) return { error: err };
  if (!input.accountId || !input.categoryId) return { error: "Akun dan kategori wajib diisi." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("post_expense", {
    ...postArgs(input),
    p_account_id: input.accountId,
    p_category_id: input.categoryId,
  });
  if (error) return { error: ledgerMessage(error) ?? "Gagal mencatat pengeluaran." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function postTransferAction(
  input: PostBase & { sourceAccountId: string; destAccountId: string },
): Promise<LedgerResult> {
  const err = validatePostBase(input);
  if (err) return { error: err };
  if (!input.sourceAccountId || !input.destAccountId)
    return { error: "Akun sumber dan tujuan wajib diisi." };
  if (input.sourceAccountId === input.destAccountId)
    return { error: "Transfer harus ke akun yang berbeda." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("post_transfer", {
    ...postArgs(input),
    p_source_account_id: input.sourceAccountId,
    p_dest_account_id: input.destAccountId,
  });
  if (error) return { error: ledgerMessage(error) ?? "Gagal mencatat transfer." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}

export async function cancelTransactionAction(input: {
  transactionId: string;
}): Promise<LedgerResult> {
  if (!input.transactionId) return { error: "ID transaksi wajib diisi." };
  const { supabase } = await requireSession();
  if (!supabase) return { error: "Sesi berakhir. Silakan masuk kembali." };
  const { data, error } = await supabase.rpc("cancel_transaction", {
    p_transaction_id: input.transactionId,
  });
  if (error) return { error: ledgerMessage(error) ?? "Gagal membatalkan transaksi." };
  const row = (Array.isArray(data) ? data[0] : data) as { id: string };
  return { ok: true, id: row.id };
}
