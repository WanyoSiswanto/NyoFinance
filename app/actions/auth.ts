"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  validateEmail,
  validateFullName,
  validatePassword,
} from "@/lib/validation";

export type AuthResult = {
  ok?: boolean;
  error?: string;
  info?: string;
  needsVerification?: boolean;
};

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

/** Login email/kata sandi. Tidak pernah mencatat kredensial ke log. */
export async function loginAction(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  const emailErr = validateEmail(email);
  if (emailErr) return { error: emailErr };
  if (!input.password) return { error: "Masukkan kata sandi." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: input.password,
  });
  if (error) {
    return { error: "Email atau kata sandi salah. Silakan coba lagi." };
  }
  return { ok: true };
}

/**
 * Registrasi. Kompatibel dengan verifikasi email Supabase:
 * jika sesi langsung tersedia -> ok; jika tidak -> pengguna harus
 * verifikasi email dulu (needsVerification).
 */
export async function registerAction(input: {
  fullName: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();

  const nameErr = validateFullName(fullName);
  if (nameErr) return { error: nameErr };
  const emailErr = validateEmail(email);
  if (emailErr) return { error: emailErr };
  const passErr = validatePassword(input.password);
  if (passErr) return { error: passErr };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${siteUrl()}/auth/callback`,
    },
  });
  if (error) {
    if (/already registered|already exists|duplicate/i.test(error.message)) {
      return { error: "Email sudah terdaftar. Silakan masuk." };
    }
    return { error: "Pendaftaran gagal. Silakan coba lagi." };
  }
  if (data.session) return { ok: true };
  return {
    ok: true,
    needsVerification: true,
    info: "Akun berhasil dibuat. Periksa email Anda untuk verifikasi, lalu masuk.",
  };
}

/** Logout: hapus sesi server lalu kembali ke halaman masuk. */
export async function logoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
