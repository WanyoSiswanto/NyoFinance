"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createFamilyAction,
  createInviteAction,
  leaveFamilyAction,
  revokeInviteAction,
} from "@/app/actions/family";
import { Alert, Card, Field, PrimaryButton, TextInput } from "@/components/ui";
import type { Family, FamilyMember } from "@/lib/database.types";

export function CreateFamilyForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await createFamilyAction({
      name: String(form.get("name") ?? ""),
      currency: String(form.get("currency") ?? "IDR"),
    });
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <Card
      title="Buat keluarga baru"
      description="Anda akan menjadi pemilik workspace ini."
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Nama keluarga" htmlFor="fam-name">
          <TextInput
            id="fam-name"
            name="name"
            required
            minLength={2}
            maxLength={80}
            placeholder="Keluarga Budi"
            disabled={loading}
          />
        </Field>
        <Field label="Mata uang (kode 3 huruf)" htmlFor="fam-currency">
          <TextInput
            id="fam-currency"
            name="currency"
            required
            defaultValue="IDR"
            maxLength={3}
            disabled={loading}
          />
        </Field>
        {error ? <Alert kind="error">{error}</Alert> : null}
        <PrimaryButton type="submit" disabled={loading}>
          {loading ? "Membuat…" : "Buat keluarga"}
        </PrimaryButton>
      </form>
    </Card>
  );
}

export function FamilyCard({
  family,
  membership,
  members,
  inviteCount,
}: {
  family: Family | null;
  membership: { role: string; family_id: string } | null;
  members: FamilyMember[];
  inviteCount: number;
}) {
  if (!family || !membership) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <CreateFamilyForm />
        <Card
          title="Sudah punya undangan?"
          description="Jika pasangan Anda sudah membuat keluarga, gabung dengan kode undangan."
        >
          <a
            href="/join"
            className="inline-flex items-center justify-center rounded-lg border border-teal-700 bg-white px-4 py-2.5 text-sm font-semibold text-teal-800 hover:bg-teal-50"
          >
            Gabung dengan undangan
          </a>
        </Card>
      </div>
    );
  }
  return (
    <Card
      title={family.name}
      description={`Mata uang: ${family.currency} • Peran Anda: ${
        membership.role === "owner" ? "Pemilik" : "Anggota"
      }`}
    >
      <div className="space-y-2 text-sm">
        <p className="text-stone-600">
          Anggota aktif: <strong className="text-stone-900">{members.length}</strong>
          {membership.role === "owner" ? (
            <>
              {" "}• Undangan tercatat:{" "}
              <strong className="text-stone-900">{inviteCount}</strong>
            </>
          ) : null}
        </p>
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between px-3 py-2">
              <span className="truncate font-mono text-xs text-stone-600">
                {m.user_id.slice(0, 8)}…
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  m.role === "owner"
                    ? "bg-teal-700/10 text-teal-800"
                    : "bg-stone-100 text-stone-700"
                }`}
              >
                {m.role === "owner" ? "Pemilik" : "Anggota"}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-stone-500">
          ID keluarga: <span className="font-mono">{family.id}</span>
        </p>
      </div>
    </Card>
  );
}

export function InvitePanel({ familyId }: { familyId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    token: string;
    joinUrl: string;
    expiresAt: string;
  } | null>(null);

  async function onCreate() {
    setError(null);
    setResult(null);
    setLoading(true);
    const res = await createInviteAction({ familyId, hours: 72 });
    setLoading(false);
    if (res.error || !res.token || !res.joinUrl || !res.expiresAt) {
      setError(res.error ?? "Gagal membuat undangan.");
      return;
    }
    setResult({
      token: res.token,
      joinUrl: res.joinUrl,
      expiresAt: res.expiresAt,
    });
    router.refresh();
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* clipboard tidak tersedia — pengguna menyalin manual */
    }
  }

  return (
    <Card
      title="Undang pasangan"
      description="Tautan sekali pakai, kedaluwarsa 72 jam. Token hanya ditampilkan sekali — segera bagikan."
    >
      <div className="space-y-3">
        <PrimaryButton onClick={onCreate} disabled={loading} type="button">
          {loading ? "Membuat undangan…" : "Buat tautan undangan"}
        </PrimaryButton>
        {error ? <Alert kind="error">{error}</Alert> : null}
        {result ? (
          <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50 p-3">
            <Alert kind="info">
              Bagikan tautan ini sekarang. Setelah halaman dimuat ulang, kode
              tidak ditampilkan lagi.
            </Alert>
            <label htmlFor="invite-url" className="block text-xs font-semibold text-teal-900">
              Tautan undangan (kedaluwarsa{" "}
              {new Date(result.expiresAt).toLocaleString("id-ID")})
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="invite-url"
                readOnly
                value={result.joinUrl}
                onFocus={(e) => e.target.select()}
                className="block w-full rounded-lg border border-teal-300 bg-white px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => copy(result.joinUrl)}
                className="shrink-0 rounded-lg bg-teal-700 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-800"
              >
                Salin
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

export type InviteRow = {
  id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  used_by: string | null;
};

export function InviteList({
  familyId,
  invites,
}: {
  familyId: string;
  invites: InviteRow[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function onRevoke(id: string) {
    setError(null);
    setBusy(id);
    const res = await revokeInviteAction({ inviteId: id });
    setBusy(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  const active = invites.filter(
    (i) =>
      !i.used_at && !i.revoked_at && new Date(i.expires_at) > new Date(),
  );

  return (
    <Card
      title="Undangan"
      description={`${active.length} aktif • ${invites.length} total tercatat`}
    >
      {error ? <Alert kind="error">{error}</Alert> : null}
      {invites.length === 0 ? (
        <p className="text-sm text-stone-600">Belum ada undangan.</p>
      ) : (
        <ul className="space-y-2">
          {invites.map((i) => {
            const expired = new Date(i.expires_at) <= new Date();
            const status = i.used_at
              ? "Dipakai"
              : i.revoked_at
                ? "Dicabut"
                : expired
                  ? "Kedaluwarsa"
                  : "Aktif";
            return (
              <li
                key={i.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{status}</p>
                  <p className="text-xs text-stone-500">
                    Dibuat {new Date(i.created_at).toLocaleString("id-ID")} •
                    kedaluwarsa {new Date(i.expires_at).toLocaleString("id-ID")}
                  </p>
                </div>
                {!i.used_at && !i.revoked_at && !expired ? (
                  <button
                    type="button"
                    disabled={busy === i.id}
                    onClick={() => onRevoke(i.id)}
                    className="shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    {busy === i.id ? "Mencabut…" : "Cabut"}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <span className="hidden">{familyId}</span>
    </Card>
  );
}

export function LeaveFamilyButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onLeave() {
    if (!window.confirm("Keluar dari keluarga ini?")) return;
    setError(null);
    setLoading(true);
    const res = await leaveFamilyAction();
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error ? <Alert kind="error">{error}</Alert> : null}
      <button
        type="button"
        onClick={onLeave}
        disabled={loading}
        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {loading ? "Memproses…" : "Keluar dari keluarga"}
      </button>
    </div>
  );
}
