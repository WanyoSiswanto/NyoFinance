import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-server";
import { PageShell } from "@/components/layout";
import { LogoutButton } from "@/components/logout-button";
import { Card } from "@/components/ui";
import { JoinForm } from "@/components/join-form";

export const dynamic = "force-dynamic";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { user } = await getAuthContext();
  if (!user) redirect("/login?next=/join");
  const params = await searchParams;

  return (
    <PageShell email={user.email} action={<LogoutButton />}>
      <div className="mx-auto max-w-md">
        <Card
          title="Gabung keluarga"
          description="Tempel kode undangan dari pasangan Anda. Undangan bersifat sekali pakai dan kedaluwarsa."
        >
          <JoinForm initialToken={params.token ?? ""} />
        </Card>
      </div>
    </PageShell>
  );
}
