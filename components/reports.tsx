"use client";

import { useRouter } from "next/navigation";
import { formatMinor, monthLabelId, shiftMonthIso } from "@/lib/money";
import type { MomResult, CategoryTotal } from "@/lib/reports";

/** Navigasi bulan laporan: ‹ label › (pertahankan query lain). */
export function ReportMonthNav({
  current,
  baseQuery,
}: {
  current: string;
  baseQuery: string;
}) {
  const router = useRouter();
  const prev = shiftMonthIso(current, -1);
  const next = shiftMonthIso(current, 1);
  const go = (firstDay: string | null) => {
    if (!firstDay) return;
    const q = new URLSearchParams(baseQuery);
    q.set("bulan", firstDay.slice(0, 7));
    q.set("hal", "1");
    router.push(`/reports?${q.toString()}`);
  };
  return (
    <nav aria-label="Navigasi bulan laporan" className="flex items-center gap-2">
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

/** Kartu ringkasan bulanan + perbandingan MoM (integer, tanpa float). */
export function MonthlyOverviewCards({
  income,
  expense,
  net,
  momIncome,
  momExpense,
  momNet,
  currency,
}: {
  income: number;
  expense: number;
  net: number;
  momIncome: MomResult;
  momExpense: MomResult;
  momNet: MomResult;
  currency: string;
}) {
  const rows = [
    { label: "Pemasukan", value: income, mom: momIncome, good: "text-teal-800" },
    { label: "Pengeluaran", value: expense, mom: momExpense, good: "text-red-700" },
    { label: "Bersih", value: net, mom: momNet, good: "text-stone-900" },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {rows.map((r) => (
        <div
          key={r.label}
          className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
        >
          <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
            {r.label}
          </p>
          <p className={`mt-1 text-xl font-bold tabular-nums ${r.good}`}>
            {formatMinor(r.value, currency)}
          </p>
          <MomLine mom={r.mom} currency={currency} />
        </div>
      ))}
    </div>
  );
}

function MomLine({ mom, currency }: { mom: MomResult; currency: string }) {
  if (mom.percentInt === null) {
    return (
      <p className="mt-1 text-xs text-stone-500">
        Δ {formatMinor(mom.deltaMinor, currency)} · bulan lalu Rp0 (tanpa %)
      </p>
    );
  }
  const sign = mom.deltaMinor > 0 ? "+" : mom.deltaMinor < 0 ? "−" : "";
  const absFmt = formatMinor(Math.abs(mom.deltaMinor), currency);
  return (
    <p className="mt-1 text-xs text-stone-500">
      Δ {sign}
      {absFmt} · {mom.percentInt}% MoM
    </p>
  );
}

/** Diagram batang CSS murni untuk distribusi beban (tanpa lib grafik). */
export function CategoryBars({
  rows,
  total,
  currency,
}: {
  rows: CategoryTotal[];
  total: number;
  currency: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-stone-800">
          Belum ada pengeluaran bulan ini.
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-stone-500">
          Catat pengeluaran lewat dasbor — distribusi per kategori akan muncul
          di sini.
        </p>
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.totalMinor), 1);
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const pct = total > 0 ? Math.floor((r.totalMinor * 100) / total) : 0;
        const width = Math.max(2, Math.floor((r.totalMinor * 100) / max));
        return (
          <li key={r.categoryId} className="text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate font-medium text-stone-800">
                {r.categoryName} · {r.count}x
              </span>
              <span className="shrink-0 tabular-nums text-stone-900">
                {formatMinor(r.totalMinor, currency)} · {pct}%
              </span>
            </div>
            <div
              className="mt-1 h-2 overflow-hidden rounded-full bg-stone-100"
              role="progressbar"
              aria-valuenow={Math.min(pct, 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${r.categoryName} ${pct} persen`}
            >
              <div
                className="h-full rounded-full bg-teal-600"
                style={{ width: `${Math.min(width, 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
