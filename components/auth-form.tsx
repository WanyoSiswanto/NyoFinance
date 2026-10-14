"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { loginAction, registerAction } from "@/app/actions/auth";
import { Alert, Field, PrimaryButton, TextInput } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await loginAction({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      <Field label="Email" htmlFor="email">
        <TextInput
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="nama@email.com"
          disabled={loading}
        />
      </Field>
      <Field label="Kata sandi" htmlFor="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="••••••••"
          disabled={loading}
        />
      </Field>
      {error ? <Alert kind="error">{error}</Alert> : null}
      <PrimaryButton type="submit" disabled={loading}>
        {loading ? "Memeriksa…" : "Masuk"}
      </PrimaryButton>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await registerAction({
      fullName: String(form.get("fullName") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (res.needsVerification) {
      setInfo(res.info ?? "Periksa email Anda untuk verifikasi.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Nama lengkap" htmlFor="fullName" error={undefined}>
        <TextInput
          id="fullName"
          name="fullName"
          type="text"
          autoComplete="name"
          required
          minLength={2}
          placeholder="Nama Anda"
          disabled={loading}
        />
      </Field>
      <Field label="Email" htmlFor="email">
        <TextInput
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="nama@email.com"
          disabled={loading}
        />
      </Field>
      <Field label="Kata sandi (min. 8 karakter)" htmlFor="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="••••••••"
          disabled={loading}
        />
      </Field>
      {error ? <Alert kind="error">{error}</Alert> : null}
      {info ? <Alert kind="success">{info}</Alert> : null}
      <PrimaryButton type="submit" disabled={loading}>
        {loading ? "Mendaftarkan…" : "Daftar"}
      </PrimaryButton>
    </form>
  );
}
