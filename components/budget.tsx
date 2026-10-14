"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, TextInput, PrimaryButton, Alert } from "@/components/ui";
import {
  budgetRemaining,
  budgetStatus,
  budgetUsagePercent,
  formatMinor,
  monthLabelId,
  parseMinorInput,
  shiftMonthIso,
} from "@/lib/money";
import { validateBudgetMonth } from "@/lib/validation";
import {
  createBudgetAction,
  updateBudgetLimitAction,
} from "@/app/actions/budget";
import type { BudgetStatus as BudgetStatusRow, Category } from "@/lib/database.types";

function useBudgetAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok?: boolean; error?: string }>) => {
    setPending(true);
    setError(null);
    try {
      const res = await fn();
      if (res?.error) {
        setError(res.error);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, run };
}

/** Formulir anggaran baru: kategori expense + bulan + batas. */
export function BudgetForm({
  familyId,
  categories,
  defaultMonth,
}: {
  familyId: string;
  categories: Category[];
  defaultMonth: string;
}) {
  const { pending, error, setError, run } = useBudgetAction();
  const [categoryId, setCategoryId] = useState("");
  const [monthInput, setMonthInput] = useState(() => defaultMonth.slice(0, 7));
  const [limit, setLimit] = useState("");

  const expenseOnly = categories.filter((c) => c.kind === "expense");

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMinorInput(limit);
        if (parsed === null || parsed < 1) {
          setError("Batas anggaran harus bilangan bulat minimal 1.");
          return;
        }
        const ok = await run(() =>
          createBudgetAction({
            familyId,
            categoryId,
            monthInput,
            limitMinor: parsed,
          }),
        );
        if (ok) {
          setCategoryId("");
          setLimit("");
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Kategori pengeluaran" htmlFor="bd-cat">
          <select
            id="bd-cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            required
          >
            <option value="">Pilih kategori</option>
            {expenseOnly.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bulan" htmlFor="bd-month">
          <TextInput
            id="bd-month"
            type="month"
            value={monthInput}
            min="2000-01"
            max="2100-12"
            onChange={(e) => setMonthInput(e.target.value)}
            required
          />
        </Field>
        <Field label="Batas (Rp)" htmlFor="bd-limit">
          <TextInput
            id="bd-limit"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="1000000"
            inputMode="numeric"
            required
          />
        </Field>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah anggaran"}
      </PrimaryButton>
    </form>
  );
}

/** Ubah batas anggaran yang sudah ada (identitas bulan/kategori dikunci). */
export function BudgetEditForm({
  budgetId,
  currentLimit,
}: {
  budgetId: string;
  currentLimit: number;
}) {
  const { pending, error, run } = useBudgetAction();
  const [limit, setLimit] = useState(() => String(currentLimit));
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:border-teal-600 hover:text-teal-800"
      >
        Ubah batas
      </button>
    );
  }
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMinorInput(limit);
        if (parsed === null) return;
        const ok = await run(() =>
          updateBudgetLimitAction({ budgetId, limitMinor: parsed }),
        );
        if (ok) setEditing(false);
      }}
    >
      <div className="w-36">
        <Field label="Batas baru (Rp)" htmlFor={`bd-edit-${budgetId}`}>
          <TextInput
            id={`bd-edit-${budgetId}`}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            inputMode="numeric"
            required
          />
        </Field>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
      >
        {pending ? "Menyimpan…" : "Simpan"}
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setLimit(String(currentLimit));
        }}
        className="rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold text-stone-600"
      >
        Batal
      </button>
      {error ? <p className="w-full text-xs text-red-700">{error}</p> : null}
    </form>
  );
}

/** Satu baris anggaran: limit, terpakai, sisa, persen + peringatan 80/100%. */
export function BudgetRow({
  row,
  currency,
}: {
  row: BudgetStatusRow;
  currency: string;
}) {
  const pct = budgetUsagePercent(row.limit_minor, row.spent_minor);
  const remaining = budgetRemaining(row.limit_minor, row.spent_minor);
  const status = budgetStatus(row.limit_minor, row.spent_minor);
  const bar =
    status === "over"
      ? "bg-red-600"
      : status === "warning"
        ? "bg-amber-500"
        : "bg-teal-600";
  return (
    <li className="rounded-xl border border-stone-200 bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">
            {row.category_name}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            Batas {formatMinor(row.limit_minor, currency)} · Terpakai{" "}
            {formatMinor(row.spent_minor, currency)} · Sisa{" "}
            {formatMinor(remaining, currency)} · {pct}%
          </p>
        </div>
        <BudgetEditForm budgetId={row.budget_id} currentLimit={row.limit_minor} />
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100"
        role="progressbar"
        aria-valuenow={Math.min(pct, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Pemakaian ${row.category_name} ${pct} persen`}
      >
        <div
          className={`h-full rounded-full ${bar}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {status === "over" ? (
        <p role="alert" className="mt-1.5 text-xs font-semibold text-red-700">
          Melebihi anggaran — pengeluaran tidak diblokir, tetapi pertimbangkan
          menahan belanja kategori ini.
        </p>
      ) : status === "warning" ? (
        <p role="status" className="mt-1.5 text-xs font-semibold text-amber-700">
          Hampir mencapai batas (≥80%).
        </p>
      ) : null}
    </li>
  );
}

/** Navigasi bulan: ‹ label › + kembali ke bulan berjalan. */
export function BudgetMonthNav({
  current,
  basePath,
}: {
  current: string;
  basePath: string;
}) {
  const router = useRouter();
  const prev = shiftMonthIso(current, -1);
  const next = shiftMonthIso(current, 1);
  const go = (firstDay: string | null) => {
    if (!firstDay) return;
    router.push(`${basePath}?bulan=${firstDay.slice(0, 7)}`);
  };
  return (
    <nav aria-label="Navigasi bulan anggaran" className="flex items-center gap-2">
      <button
        type="button"
        disabled={!prev}
        onClick={() => go(prev)}
        aria-label="Bulan sebelumnya"
        className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:border-teal-600 hover:text-teal-800 disabled:opacity-40"
      >
        ‹
      </button>
      <span className="min-w-32 text-center text-sm font-semibold text-stone-900">
        {monthLabelId(current)}
      </span>
      <button
        type="button"
        disabled={!next}
        onClick={() => go(next)}
        aria-label="Bulan berikutnya"
        className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 hover:border-teal-600 hover:text-teal-800 disabled:opacity-40"
      >
        ›
      </button>
    </nav>
  );
}

/** Kartu daftar anggaran sebulan + empty state. */
export function BudgetList({
  rows,
  currency,
  current,
  basePath,
  hasExpenseCategories,
}: {
  rows: BudgetStatusRow[];
  currency: string;
  current: string;
  basePath: string;
  hasExpenseCategories: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-stone-800">
          Belum ada anggaran untuk {monthLabelId(current)}.
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-stone-500">
          {hasExpenseCategories
            ? "Tambahkan anggaran pertama lewat formulir di bawah — pilih kategori pengeluaran, bulan, dan batas."
            : "Buat dulu kategori pengeluaran (mis. “Belanja”) lewat kartu “Tambah akun & kategori”, lalu kembali ke sini."}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <BudgetMonthNav current={current} basePath={basePath} />
      <ul className="space-y-2">
        {rows.map((r) => (
          <BudgetRow key={r.budget_id} row={r} currency={currency} />
        ))}
      </ul>
    </div>
  );
}

/** Validasi ringan input bulan "YYYY-MM" di sisi klien (navigasi manual). */
export function isValidBudgetMonthInput(input: string): boolean {
  return !("error" in validateBudgetMonth(input));
}
