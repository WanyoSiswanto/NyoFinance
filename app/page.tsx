import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageShell } from "@/components/layout";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  return (
    <PageShell email={data.user?.email}>
      <div className="grid gap-8 py-8 sm:py-14 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-800">
            Untuk suami dan istri — satu keuangan rumah tangga
          </p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl">
            Kelola keuangan keluarga dalam satu tempat yang rapi.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-stone-600">
            NyoFinance membantu pasangan suami-istri mengelola keuangan rumah
            tangga bersama: satu workspace keluarga, undangan aman untuk
            pasangan, dan fondasi keamanan yang kuat.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            {data.user ? (
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Buka dasbor
              </Link>
            ) : (
              <>
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800"
                >
                  Buat akun gratis
                </Link>
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-800 hover:border-teal-600 hover:text-teal-800"
                >
                  Masuk
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold tracking-wide text-stone-500 uppercase">
            Cara kerja — Fase 1
          </h2>
          <ol className="mt-4 space-y-4">
            {[
              ["1. Daftar dan masuk", "Buat akun dengan email dan kata sandi."],
              ["2. Buat keluarga", "Salah satu pasangan membuat workspace keluarga."],
              ["3. Undang pasangan", "Bagikan tautan undangan sekali pakai yang kedaluwarsa."],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-700/10 text-xs font-bold text-teal-800">
                  {t.charAt(0)}
                </span>
                <div>
                  <p className="text-sm font-semibold">{t}</p>
                  <p className="text-sm text-stone-600">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </PageShell>
  );
}
