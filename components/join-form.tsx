"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInviteAction } from "@/app/actions/family";
import { Alert, Field, PrimaryButton, TextInput } from "@/components/ui";

export function JoinForm({ initialToken }: { initialToken: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await acceptInviteAction({
      token: String(form.get("token") ?? ""),
    });
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOk(true);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Kode undangan" htmlFor="join-token">
        <TextInput
          id="join-token"
          name="token"
          required
          defaultValue={initialToken}
          placeholder="Tempel kode undangan di sini"
          autoComplete="off"
          spellCheck={false}
          disabled={loading || ok}
        />
      </Field>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {ok ? <Alert kind="success">Berhasil bergabung! Mengalihkan…</Alert> : null}
      <PrimaryButton type="submit" disabled={loading || ok}>
        {loading ? "Memeriksa undangan…" : "Gabung keluarga"}
      </PrimaryButton>
    </form>
  );
}
