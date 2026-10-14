"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, TextInput, PrimaryButton, Alert } from "@/components/ui";
import { formatMinor, parseMinorInput, generateIdempotencyKey } from "@/lib/money";
import {
  estimatedMonthlyContribution,
  goalProgressLabel,
  goalProgressPercent,
  goalRemaining,
  monthsLeftToTarget,
} from "@/lib/savings";
import {
  archiveGoalAction,
  cancelContributionAction,
  completeGoalAction,
  contributeToGoalAction,
  createGoalAction,
  updateGoalAction,
} from "@/app/actions/savings";
import type {
  GoalContribution,
  GoalStatusRow,
  SavingsGoal,
} from "@/lib/database.types";

function useSavingsAction() {
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Formulir tujuan baru: nama + target + deskripsi + tanggal target opsional. */
export function GoalForm({ familyId }: { familyId: string }) {
  const { pending, error, setError, run } = useSavingsAction();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");
  const [targetDate, setTargetDate] = useState("");

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMinorInput(target);
        if (parsed === null || parsed < 1) {
          setError("Target tabungan harus bilangan bulat minimal 1.");
          return;
        }
        const ok = await run(() =>
          createGoalAction({
            familyId,
            name,
            description: description.trim() ? description : null,
            targetMinor: parsed,
            targetDateInput: targetDate.trim() ? targetDate : null,
          }),
        );
        if (ok) {
          setName("");
          setTarget("");
          setDescription("");
          setTargetDate("");
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nama tujuan" htmlFor="goal-name">
          <TextInput
            id="goal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dana darurat"
            required
            maxLength={80}
          />
        </Field>
        <Field label="Target (Rp)" htmlFor="goal-target">
          <TextInput
            id="goal-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="10000000"
            inputMode="numeric"
            required
          />
        </Field>
      </div>
      <Field label="Deskripsi (opsional)" htmlFor="goal-desc">
        <TextInput
          id="goal-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Untuk keadaan darurat 3 bulan"
          maxLength={500}
        />
      </Field>
      <Field label="Target tanggal (opsional)" htmlFor="goal-date">
        <TextInput
          id="goal-date"
          type="date"
          value={targetDate}
          min="2000-01-01"
          max="2100-12-31"
          onChange={(e) => setTargetDate(e.target.value)}
        />
      </Field>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <PrimaryButton type="submit" disabled={pending}>
        {pending ? "Menyimpan…" : "Buat tujuan"}
      </PrimaryButton>
    </form>
  );
}

/** Ubah tujuan aktif (nama/deskripsi/target/tanggal). */
export function GoalEditForm({ goal }: { goal: SavingsGoal }) {
  const { pending, error, run } = useSavingsAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(goal.name);
  const [target, setTarget] = useState(String(goal.target_minor));
  const [description, setDescription] = useState(goal.description ?? "");
  const [targetDate, setTargetDate] = useState(goal.target_date ?? "");

  if (goal.status !== "active") return null;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-700 hover:border-teal-600 hover:text-teal-800"
      >
        Ubah
      </button>
    );
  }
  return (
    <form
      className="mt-2 space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMinorInput(target);
        if (parsed === null || parsed < 1) return;
        const ok = await run(() =>
          updateGoalAction({
            goalId: goal.id,
            name,
            description: description.trim() ? description : null,
            targetMinor: parsed,
            targetDateInput: targetDate.trim() ? targetDate : null,
          }),
        );
        if (ok) setEditing(false);
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Nama" htmlFor={`ge-name-${goal.id}`}>
          <TextInput
            id={`ge-name-${goal.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
          />
        </Field>
        <Field label="Target (Rp)" htmlFor={`ge-target-${goal.id}`}>
          <TextInput
            id={`ge-target-${goal.id}`}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="numeric"
            required
          />
        </Field>
      </div>
      <Field label="Deskripsi" htmlFor={`ge-desc-${goal.id}`}>
        <TextInput
          id={`ge-desc-${goal.id}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
        />
      </Field>
      <Field label="Target tanggal" htmlFor={`ge-date-${goal.id}`}>
        <TextInput
          id={`ge-date-${goal.id}`}
          type="date"
          value={targetDate}
          min="2000-01-01"
          max="2100-12-31"
          onChange={(e) => setTargetDate(e.target.value)}
        />
      </Field>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {pending ? "Menyimpan…" : "Simpan"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setName(goal.name);
            setTarget(String(goal.target_minor));
            setDescription(goal.description ?? "");
            setTargetDate(goal.target_date ?? "");
          }}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-600"
        >
          Batal
        </button>
      </div>
    </form>
  );
}

/** Tombol selesaikan / arsipkan (transisi maju saja). */
export function GoalStatusButtons({ goal }: { goal: SavingsGoal }) {
  const { pending, error, run } = useSavingsAction();
  if (goal.status === "archived") return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {goal.status === "active" ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => completeGoalAction({ goalId: goal.id }))}
          className="rounded-lg border border-teal-700 px-2.5 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50"
        >
          Tandai selesai
        </button>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => archiveGoalAction({ goalId: goal.id }))}
        className="rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-600 hover:border-stone-500 disabled:opacity-50"
      >
        Arsipkan
      </button>
      {error ? <p className="w-full text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

/** Formulir setoran alokasi ke satu tujuan (bukan transaksi ledger). */
export function ContributeForm({ goal }: { goal: SavingsGoal }) {
  const { pending, error, setError, run } = useSavingsAction();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => todayIso());
  const [open, setOpen] = useState(false);

  if (goal.status === "archived") return null;
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
      >
        + Setor
      </button>
    );
  }
  return (
    <form
      className="mt-2 space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = parseMinorInput(amount);
        if (parsed === null || parsed < 1) {
          setError("Nominal setoran harus bilangan bulat minimal 1.");
          return;
        }
        const ok = await run(() =>
          contributeToGoalAction({
            goalId: goal.id,
            amountMinor: parsed,
            note: note.trim() ? note : null,
            occurredAt: date,
            idempotencyKey: generateIdempotencyKey(),
          }),
        );
        if (ok) {
          setAmount("");
          setNote("");
          setOpen(false);
        }
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Nominal (Rp)" htmlFor={`ct-amt-${goal.id}`}>
          <TextInput
            id={`ct-amt-${goal.id}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500000"
            inputMode="numeric"
            required
          />
        </Field>
        <Field label="Tanggal" htmlFor={`ct-date-${goal.id}`}>
          <TextInput
            id={`ct-date-${goal.id}`}
            type="date"
            value={date}
            max={todayIso()}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="Catatan (opsional)" htmlFor={`ct-note-${goal.id}`}>
        <TextInput
          id={`ct-note-${goal.id}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
      </Field>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {pending ? "Menyimpan…" : "Simpan setoran"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-600"
        >
          Batal
        </button>
      </div>
    </form>
  );
}

/** Satu baris tujuan: progres integer + sisa + estimasi + aksi. */
export function GoalRow({
  status,
  goal,
  currency,
}: {
  status: GoalStatusRow;
  goal: SavingsGoal | undefined;
  currency: string;
}) {
  const target = status.target_minor;
  const allocated = status.allocated_minor;
  const remaining = goalRemaining(target, allocated);
  const pct = goalProgressPercent(target, allocated);
  const label = goalProgressLabel(target, allocated);
  const monthsLeft = monthsLeftToTarget(status.target_date);
  const estimated = estimatedMonthlyContribution(remaining, monthsLeft);
  const bar =
    label === "terlampaui" || label === "tercapai"
      ? "bg-teal-600"
      : label === "berjalan"
        ? "bg-teal-500"
        : "bg-stone-300";
  const labelText =
    label === "belum-mulai"
      ? "Belum mulai"
      : label === "berjalan"
        ? "Berjalan"
        : label === "tercapai"
          ? "Tercapai"
          : "Terlampaui";

  return (
    <li className="rounded-xl border border-stone-200 bg-white px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-stone-900">
            {status.goal_name}{" "}
            <span className="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-600">
              {labelText} · {status.status}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-stone-500">
            Target {formatMinor(target, currency)} · Terkumpul{" "}
            {formatMinor(allocated, currency)} · Sisa{" "}
            {formatMinor(remaining, currency)} · {pct}%
          </p>
          {status.target_date ? (
            <p className="mt-0.5 text-xs text-stone-500">
              Target {status.target_date}
              {monthsLeft !== null ? ` · ${monthsLeft} bulan tersisa` : ""}
              {estimated !== null ? ` · Estimasi ${formatMinor(estimated, currency)}/bln` : ""}
            </p>
          ) : null}
          {goal?.description ? (
            <p className="mt-0.5 truncate text-xs text-stone-500">{goal.description}</p>
          ) : null}
        </div>
        {goal ? (
          <div className="flex shrink-0 flex-col items-end gap-2">
            <ContributeForm goal={goal} />
            <GoalEditForm goal={goal} />
          </div>
        ) : null}
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-stone-100"
        role="progressbar"
        aria-valuenow={Math.min(pct, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Progres ${status.goal_name} ${pct} persen`}
      >
        <div
          className={`h-full rounded-full ${bar}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {goal ? (
        <div className="mt-2">
          <GoalStatusButtons goal={goal} />
        </div>
      ) : null}
    </li>
  );
}

/** Daftar tujuan + empty state. */
export function GoalList({
  rows,
  goals,
  currency,
}: {
  rows: GoalStatusRow[];
  goals: SavingsGoal[];
  currency: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-6 text-center">
        <p className="text-sm font-semibold text-stone-800">Belum ada tujuan tabungan.</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-stone-500">
          Buat tujuan pertama lewat formulir di bawah — mis. “Dana darurat” dengan target dan
          tanggal. Setoran bersifat alokasi dan tidak mengubah saldo akun atau laporan.
        </p>
      </div>
    );
  }
  const byId = new Map(goals.map((g) => [g.id, g]));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <GoalRow key={r.goal_id} status={r} goal={byId.get(r.goal_id)} currency={currency} />
      ))}
    </ul>
  );
}

/** Riwayat kontribusi satu keluarga (50 terbaru) + batalkan. */
export function ContributionList({
  rows,
  currency,
  goalName,
}: {
  rows: GoalContribution[];
  currency: string;
  goalName: (goalId: string) => string;
}) {
  const { pending, error, run } = useSavingsAction();
  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 py-4 text-center text-xs text-stone-500">
        Belum ada setoran. Setoran pertama akan muncul di sini dan menambah progres tujuan tanpa
        mengubah laporan income/expense.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
        {rows.map((c) => (
          <li key={c.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-stone-900">
                {goalName(c.goal_id)} · {formatMinor(c.amount_minor, currency)}{" "}
                <span
                  className={`ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    c.status === "posted"
                      ? "bg-teal-50 text-teal-800"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {c.status === "posted" ? "posted" : "cancelled"}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-stone-500">
                {c.occurred_at}
                {c.note ? ` · ${c.note}` : ""}
              </p>
            </div>
            {c.status === "posted" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => cancelContributionAction({ contributionId: c.id }))}
                className="shrink-0 rounded-lg border border-stone-300 px-2.5 py-1 text-xs font-semibold text-stone-600 hover:border-red-500 hover:text-red-700 disabled:opacity-50"
              >
                Batalkan
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
