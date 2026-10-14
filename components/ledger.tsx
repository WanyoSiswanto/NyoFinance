"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, TextInput, PrimaryButton, Alert } from "@/components/ui";
import { formatMinor, parseMinorInput, generateIdempotencyKey } from "@/lib/money";
import {
  cancelTransactionAction,
  createAccountAction,
  createCategoryAction,
  postExpenseAction,
  postIncomeAction,
  postTransferAction,
} from "@/app/actions/ledger";
import type {
  Account,
  AccountBalance,
  Category,
  MonthlySummary,
  Transaction,
} from "@/lib/database.types";

function useAsyncAction() {
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

export function AccountForm({ familyId }: { familyId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("0");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMinorInput(opening);
        if (parsed === null) {
          setError("Saldo awal tidak valid.");
          return;
        }
        setPending(true);
        setError(null);
        try {
          const res = await createAccountAction({
            familyId,
            name,
            openingMinor: parsed,
          });
          if (res.error) {
            setError(res.error);
            return;
          }
          setName("");
          setOpening("0");
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama akun" htmlFor="acc-name">
          <TextInput
            id="acc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dompet / Bank"
            required
            maxLength={80}
          />
        </Field>
        <Field label="Saldo awal (Rp)" htmlFor="acc-opening">
          <TextInput
            id="acc-opening"
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            placeholder="0"
            inputMode="numeric"
            required
          />
        </Field>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah akun"}
      </PrimaryButton>
    </form>
  );
}

export function CategoryForm({ familyId }: { familyId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          const res = await createCategoryAction({ familyId, name, kind });
          if (res.error) {
            setError(res.error);
            return;
          }
          setName("");
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama kategori" htmlFor="cat-name">
          <TextInput
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gaji / Belanja"
            required
            maxLength={80}
          />
        </Field>
        <Field label="Jenis" htmlFor="cat-kind">
          <select
            id="cat-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "income" | "expense")}
            className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="expense">Pengeluaran</option>
            <option value="income">Pemasukan</option>
          </select>
        </Field>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Tambah kategori"}
      </PrimaryButton>
    </form>
  );
}

export function IncomeExpenseForm({
  familyId,
  accounts,
  categories,
}: {
  familyId: string;
  accounts: Account[];
  categories: Category[];
}) {
  const { pending, error, run } = useAsyncAction();
  const [kind, setKind] = useState<"income" | "expense">("expense");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [idem, setIdem] = useState(() => generateIdempotencyKey());

  const filtered = categories.filter((c) => c.kind === kind);

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMinorInput(amount);
        if (parsed === null || parsed < 1) {
          return;
        }
        const ok = await run(() =>
          kind === "income"
            ? postIncomeAction({
                familyId,
                accountId,
                categoryId,
                amountMinor: parsed,
                note: note || null,
                occurredAt: date,
                idempotencyKey: idem,
              })
            : postExpenseAction({
                familyId,
                accountId,
                categoryId,
                amountMinor: parsed,
                note: note || null,
                occurredAt: date,
                idempotencyKey: idem,
              }),
        );
        if (ok) {
          setAmount("");
          setNote("");
          setIdem(generateIdempotencyKey());
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Jenis" htmlFor="tx-kind">
          <select
            id="tx-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "income" | "expense")}
            className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          >
            <option value="expense">Pengeluaran</option>
            <option value="income">Pemasukan</option>
          </select>
        </Field>
        <Field label="Tanggal" htmlFor="tx-date">
          <TextInput
            id="tx-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Akun" htmlFor="tx-acc">
          <select
            id="tx-acc"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            required
          >
            <option value="">Pilih akun</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Kategori" htmlFor="tx-cat">
          <select
            id="tx-cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            required
          >
            <option value="">Pilih kategori</option>
            {filtered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nominal (Rp)" htmlFor="tx-amount">
          <TextInput
            id="tx-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="50000"
            inputMode="numeric"
            required
          />
        </Field>
        <Field label="Catatan (opsional)" htmlFor="tx-note">
          <TextInput
            id="tx-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Keterangan singkat"
            maxLength={500}
          />
        </Field>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : kind === "income" ? "Catat pemasukan" : "Catat pengeluaran"}
      </PrimaryButton>
    </form>
  );
}

export function TransferForm({
  familyId,
  accounts,
}: {
  familyId: string;
  accounts: Account[];
}) {
  const { pending, error, run } = useAsyncAction();
  const [source, setSource] = useState("");
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [idem, setIdem] = useState(() => generateIdempotencyKey());

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMinorInput(amount);
        if (parsed === null || parsed < 1) return;
        const ok = await run(() =>
          postTransferAction({
            familyId,
            sourceAccountId: source,
            destAccountId: dest,
            amountMinor: parsed,
            note: note || null,
            occurredAt: date,
            idempotencyKey: idem,
          }),
        );
        if (ok) {
          setAmount("");
          setNote("");
          setIdem(generateIdempotencyKey());
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dari akun" htmlFor="tf-src">
          <select
            id="tf-src"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            required
          >
            <option value="">Pilih akun</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ke akun" htmlFor="tf-dst">
          <select
            id="tf-dst"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            className="block w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            required
          >
            <option value="">Pilih akun</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nominal (Rp)" htmlFor="tf-amount">
          <TextInput
            id="tf-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="100000"
            inputMode="numeric"
            required
          />
        </Field>
        <Field label="Tanggal" htmlFor="tf-date">
          <TextInput
            id="tf-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <Field label="Catatan (opsional)" htmlFor="tf-note">
          <TextInput
            id="tf-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />
        </Field>
      </div>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Catat transfer"}
      </PrimaryButton>
    </form>
  );
}

export function CancelButton({ transactionId }: { transactionId: string }) {
  const { pending, error, run } = useAsyncAction();
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => cancelTransactionAction({ transactionId }))}
        className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:border-red-500 hover:text-red-700 disabled:opacity-50"
      >
        {pending ? "Membatalkan…" : "Batalkan"}
      </button>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

export function BalancesCard({
  balances,
  total,
  currency,
}: {
  balances: AccountBalance[];
  total: number;
  currency: string;
}) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Saldo keluarga</h2>
      <p className="mt-1 text-2xl font-bold tracking-tight">
        {formatMinor(total, currency)}
      </p>
      <ul className="mt-4 space-y-2">
        {balances.map((b) => (
          <li
            key={b.account_id}
            className="flex items-center justify-between border-t border-stone-100 pt-2 text-sm"
          >
            <span className="font-medium text-stone-800">{b.account_name}</span>
            <span className="tabular-nums text-stone-900">
              {formatMinor(b.balance_minor, currency)}
            </span>
          </li>
        ))}
        {balances.length === 0 ? (
          <li className="text-sm text-stone-500">Belum ada akun.</li>
        ) : null}
      </ul>
    </div>
  );
}

export function MonthlyCard({
  summary,
  currency,
}: {
  summary: MonthlySummary | null;
  currency: string;
}) {
  if (!summary) return null;
  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold">Arus kas bulan ini</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-stone-600">Pemasukan</dt>
          <dd className="font-semibold text-teal-800">
            {formatMinor(summary.income_total_minor, currency)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-stone-600">Pengeluaran</dt>
          <dd className="font-semibold text-red-700">
            {formatMinor(summary.expense_total_minor, currency)}
          </dd>
        </div>
        <div className="flex justify-between border-t border-stone-100 pt-2">
          <dt className="text-stone-600">Bersih</dt>
          <dd className="font-bold">{formatMinor(summary.net_minor, currency)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function HistoryList({
  transactions,
  currency,
  accountName,
}: {
  transactions: Transaction[];
  currency: string;
  accountName: (t: Transaction) => string;
}) {
  if (transactions.length === 0) {
    return <p className="text-sm text-stone-500">Belum ada transaksi.</p>;
  }
  return (
    <ul className="space-y-2">
      {transactions.map((t) => (
        <li
          key={t.id}
          className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-stone-900">
              {t.kind === "transfer" ? "Transfer" : t.kind === "income" ? "Pemasukan" : "Pengeluaran"}{" "}
              · {formatMinor(t.amount_minor, currency)}
            </p>
            <p className="mt-0.5 text-xs text-stone-500">
              {accountName(t)} · {t.occurred_at} · {t.status}
              {t.note ? ` · ${t.note}` : ""}
            </p>
          </div>
          {t.status === "posted" ? <CancelButton transactionId={t.id} /> : null}
        </li>
      ))}
    </ul>
  );
}
