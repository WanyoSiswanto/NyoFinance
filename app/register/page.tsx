import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-server";
import { PageShell } from "@/components/layout";
import { Card } from "@/components/ui";
import { RegisterForm } from "@/components/auth-form";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const { user } = await getAuthContext();
  if (user) redirect("/dashboard");

  return (
    <PageShell narrow>
      <Card
        title="Buat akun NyoFinance"
        description="Satu akun untuk Anda — pasangan bergabung lewat undangan."
      >
        <RegisterForm />
        <p className="mt-4 text-center text-sm text-stone-600">
          Sudah punya akun?{" "}
          <a href="/login" className="font-semibold text-teal-800 hover:underline">
            Masuk di sini
          </a>
        </p>
      </Card>
    </PageShell>
  );
}
