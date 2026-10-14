import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-server";
import { PageShell } from "@/components/layout";
import { LogoutButton } from "@/components/logout-button";
import { Card } from "@/components/ui";
import {
  ContributionList,
  GoalForm,
  GoalList,
} from "@/components/savings";
import type {
  Family,
  FamilyMember,
  GoalContribution,
  GoalStatusRow,
  SavingsGoal,
} from "@/lib/database.types";

export const dynamic = "force-dynamic";

type MembershipRow = FamilyMember & { families: Family | null };

export default async function GoalsPage() {
  const { supabase, user } = await getAuthContext();
  if (!user || !supabase) redirect("/login");

  const { data: membership } = await supabase
    .from("family_members")
    .select(
      "family_id,user_id,role,status,joined_at,families(id,name,currency,created_at,updated_at,created_by)",
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const row = membership as unknown as MembershipRow | null;
  const family = row?.families ?? null;

  if (!row || !family) {
    return (
      <PageShell email={user.email} action={<LogoutButton />}>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tujuan tabungan</h1>
            <p className="mt-1 text-sm text-stone-600">
              Buat keluarga atau gabung dengan undangan untuk mulai menabung bersama.
            </p>
          </div>
          <Card title="Belum ada keluarga">
            <Link
              href="/dashboard"
              className="text-sm font-semibold text-teal-800 hover:underline"
            >
              Kembali ke dasbor
            </Link>
          </Card>
        </div>
      </PageShell>
    );
  }

  // Status otoritatif: target + sum(posted kontribusi) via RPC.
  const { data: statusRows } = await supabase.rpc("get_goal_status", {
    p_family_id: row.family_id,
  });
  const statuses = (statusRows ?? []) as GoalStatusRow[];

  const { data: goalRows } = await supabase
    .from("savings_goals")
    .select("id,family_id,name,description,target_minor,target_date,status,created_by,created_at,updated_at")
    .eq("family_id", row.family_id)
    .order("created_at", { ascending: true });
  const goals = (goalRows ?? []) as SavingsGoal[];

  const { data: contribRows } = await supabase
    .from("goal_contributions")
    .select(
      "id,family_id,goal_id,amount_minor,note,occurred_at,status,cancelled_at,cancelled_by,idempotency_key,created_by,created_at",
    )
    .eq("family_id", row.family_id)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);
  const contributions = (contribRows ?? []) as GoalContribution[];
  const names = new Map(goals.map((g) => [g.id, g.name]));

  return (
    <PageShell email={user.email} action={<LogoutButton />}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tujuan tabungan</h1>
          <p className="mt-1 text-sm text-stone-600">
            Setoran bersifat alokasi — tidak menambah pemasukan, tidak mengubah saldo akun,
            dan tidak muncul di laporan income/expense.
          </p>
        </div>

        <Card
          title="Daftar tujuan"
          description="Progres = sum(setoran posted) per tujuan; persen memakai aritmetika integer."
        >
          <GoalList rows={statuses} goals={goals} currency={family.currency} />
        </Card>

        <Card title="Buat tujuan baru">
          <GoalForm familyId={row.family_id} />
        </Card>

        <Card
          title="Riwayat setoran (50 terbaru)"
          description="Pembatalan bersifat reversal audit: baris dipertahankan dengan status cancelled."
        >
          <ContributionList
            rows={contributions}
            currency={family.currency}
            goalName={(id) => names.get(id) ?? "—"}
          />
        </Card>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:border-teal-600 hover:text-teal-800"
          >
            Kembali ke dasbor
          </Link>
          <Link
            href="/reports"
            className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:border-teal-600 hover:text-teal-800"
          >
            Lihat laporan
          </Link>
        </div>
      </div>
    </PageShell>
  );
}
