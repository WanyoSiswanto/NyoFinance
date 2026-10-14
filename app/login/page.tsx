import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-server";
import { PageShell } from "@/components/layout";
import { Card } from "@/components/ui";
import { LoginForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await getAuthContext();
  if (user) redirect("/dashboard");
  const params = await searchParams;

  return (
    <PageShell narrow>
      <Card
        title="Masuk ke NyoFinance"
        description="Masuk untuk mengelola keuangan keluarga Anda."
      >
        {params.error === "verifikasi-gagal" ? (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            Verifikasi email gagal atau kedaluwarsa. Silakan coba masuk atau daftar ulang.
          </div>
        ) : null}
        <LoginForm />
        <p className="mt-4 text-center text-sm text-stone-600">
          Belum punya akun?{" "}
          <a href="/register" className="font-semibold text-teal-800 hover:underline">
            Daftar di sini
          </a>
        </p>
      </Card>
    </PageShell>
  );
}
