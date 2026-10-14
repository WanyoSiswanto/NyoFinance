import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-server";
import { PageShell } from "@/components/layout";
import { LogoutButton } from "@/components/logout-button";
import { FamilyCard } from "@/components/family-card";
import {
  AccountForm,
  BalancesCard,
  CategoryForm,
  HistoryList,
  IncomeExpenseForm,
  MonthlyCard,
  TransferForm,
} from "@/components/ledger";
import { BudgetForm, BudgetList } from "@/components/budget";
import { formatMinor } from "@/lib/money";
import { validateBudgetMonth } from "@/lib/validation";
import { Card } from "@/components/ui";
import type {
  Account,
  AccountBalance,
  BudgetStatus,
  Category,
  Family,
  FamilyMember,
  MonthlySummary,
  Transaction,
} from "@/lib/database.types";

export const dynamic = "force-dynamic";

type MembershipRow = FamilyMember & { families: Family | null };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ bulan?: string }>;
}) {
  const { supabase, user } = await getAuthContext();
  if (!user || !supabase) redirect("/login");

  // Bulan anggaran dari ?bulan=YYYY-MM; fallback ke bulan berjalan.
  // Riwayat anggaran tetap tersimpan — navigasi bulan tidak menghapus data.
  const sp = (await searchParams) ?? {};
  const rawMonth = typeof sp.bulan === "string" ? sp.bulan : "";
  const parsedMonth =
    rawMonth.trim() === "" ? null : validateBudgetMonth(rawMonth);
  const now = new Date();
  const fallbackMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const budgetMonth =
    parsedMonth && "firstDay" in parsedMonth ? parsedMonth.firstDay : fallbackMonth;

  const { data: membership } = await supabase
    .from("family_members")
    .select("family_id,user_id,role,status,joined_at,families(id,name,currency,created_at,updated_at,created_by)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  const row = membership as unknown as MembershipRow | null;
  const family = row?.families ?? null;

  let members: FamilyMember[] = [];
  let inviteCount = 0;
  let accounts: Account[] = [];
  let categories: Category[] = [];
  let balances: AccountBalance[] = [];
  let familyTotal = 0;
  let monthly: MonthlySummary | null = null;
  let history: Transaction[] = [];
  let budgets: BudgetStatus[] = [];
  let goalCount = 0;
  let goalAllocated = 0;
  if (row) {
    const { data: memberRows } = await supabase
      .from("family_members")
      .select("family_id,user_id,role,status,joined_at")
      .eq("family_id", row.family_id)
      .eq("status", "active")
      .order("joined_at", { ascending: true });
    members = (memberRows ?? []) as FamilyMember[];
    if (row.role === "owner") {
      const { data: invites } = await supabase.rpc("list_family_invites", {
        p_family_id: row.family_id,
      });
      inviteCount = Array.isArray(invites) ? invites.length : 0;
    }
    const { data: accountRows } = await supabase
      .from("accounts")
      .select("id,family_id,name,opening_balance_minor,created_by,created_at,updated_at")
      .eq("family_id", row.family_id)
      .order("name", { ascending: true });
    accounts = (accountRows ?? []) as Account[];
    const { data: categoryRows } = await supabase
      .from("categories")
      .select("id,family_id,name,kind,created_by,created_at")
      .eq("family_id", row.family_id)
      .order("name", { ascending: true });
    categories = (categoryRows ?? []) as Category[];
    const { data: balanceRows } = await supabase.rpc("get_account_balances", {
      p_family_id: row.family_id,
    });
    balances = (balanceRows ?? []) as AccountBalance[];
    const { data: totalRows } = await supabase.rpc("get_family_total", {
      p_family_id: row.family_id,
    });
    // get_family_total returns a scalar bigint (not a table row).
    if (typeof totalRows === "number") {
      familyTotal = totalRows;
    } else if (Array.isArray(totalRows)) {
      const first = totalRows[0] as unknown;
      familyTotal =
        typeof first === "number"
          ? first
          : Number(
              (first as { total_balance_minor?: number } | null)?.total_balance_minor ?? 0,
            );
    } else if (totalRows !== null && typeof totalRows === "object") {
      familyTotal = Number(
        (totalRows as { total_balance_minor?: number }).total_balance_minor ?? 0,
      );
    }
    const now = new Date();
    const { data: monthlyRows } = await supabase.rpc("get_monthly_summary", {
      p_family_id: row.family_id,
      p_year: now.getFullYear(),
      p_month: now.getMonth() + 1,
    });
    monthly = (Array.isArray(monthlyRows) ? monthlyRows[0] : monthlyRows) as MonthlySummary | null;
    const { data: budgetRows } = await supabase.rpc("get_budget_status", {
      p_family_id: row.family_id,
      p_year: Number(budgetMonth.slice(0, 4)),
      p_month: Number(budgetMonth.slice(5, 7)),
    });
    budgets = (budgetRows ?? []) as BudgetStatus[];
    // Ringkasan tujuan: hitung dari RPC otoritatif agar konsisten dengan /goals.
    const { data: goalRows } = await supabase.rpc("get_goal_status", {
      p_family_id: row.family_id,
    });
    const goalStatuses = (goalRows ?? []) as {
      allocated_minor: number;
      status: string;
    }[];
    goalCount = goalStatuses.filter((g) => g.status === "active").length;
    {
      let total = BigInt(0);
      for (const g of goalStatuses) total += BigInt(g.allocated_minor);
      goalAllocated = Number(total);
    }
    const { data: historyRows } = await supabase
      .from("transactions")
      .select(
        "id,family_id,kind,amount_minor,account_id,category_id,source_account_id,dest_account_id,note,occurred_at,status,cancelled_at,cancelled_by,idempotency_key,created_by,created_at",
      )
      .eq("family_id", row.family_id)
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50);
    history = (historyRows ?? []) as Transaction[];
  }

  return (
    <PageShell email={user.email} action={<LogoutButton />}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dasbor</h1>
          <p className="mt-1 text-sm text-stone-600">
            {family
              ? "Saldo dan ringkasan dihitung dari riwayat transaksi keluarga."
              : "Buat keluarga atau gabung dengan undangan untuk mulai mencatat keuangan."}
          </p>
        </div>

        <FamilyCard
          family={family}
          membership={row ? { role: row.role, family_id: row.family_id } : null}
          members={members}
          inviteCount={inviteCount}
        />

        {family && row ? (
          <div className="grid gap-4 md:grid-cols-2">
            <BalancesCard
              balances={balances}
              total={familyTotal}
              currency={family.currency}
            />
            <MonthlyCard summary={monthly} currency={family.currency} />
          </div>
        ) : null}

        {family && row ? (
          <Card title="Tambah akun & kategori">
            <div className="grid gap-6 md:grid-cols-2">
              <AccountForm familyId={row.family_id} />
              <CategoryForm familyId={row.family_id} />
            </div>
          </Card>
        ) : null}

        {family && row ? (
          <Card title="Catat transaksi">
            <div className="grid gap-6 md:grid-cols-2">
              <IncomeExpenseForm
                familyId={row.family_id}
                accounts={accounts}
                categories={categories}
              />
              <TransferForm familyId={row.family_id} accounts={accounts} />
            </div>
          </Card>
        ) : null}

        {family && row ? (
          <Card title="Anggaran bulanan">
            <div className="space-y-6">
              <BudgetList
                rows={budgets}
                currency={family.currency}
                current={budgetMonth}
                basePath="/dashboard"
                hasExpenseCategories={categories.some(
                  (c) => c.kind === "expense",
                )}
              />
              <BudgetForm
                familyId={row.family_id}
                categories={categories}
                defaultMonth={budgetMonth}
              />
            </div>
          </Card>
        ) : null}

        {family && row ? (
          <Card
            title="Tujuan tabungan"
            description="Alokasi terkumpul tidak mengubah saldo akun maupun laporan."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-stone-700">
                {goalCount} tujuan aktif · Terkumpul{" "}
                {formatMinor(goalAllocated, family.currency)}
              </p>
              <Link
                href="/goals"
                className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Kelola tujuan
              </Link>
            </div>
          </Card>
        ) : null}

        {family && row ? (
          <Card title="Riwayat transaksi (50 terbaru)">
            <HistoryList
              transactions={history}
              currency={family.currency}
              accountName={(t) => {
                const names = new Map(accounts.map((a) => [a.id, a.name]));
                if (t.kind === "transfer") {
                  return `${names.get(t.source_account_id ?? "") ?? "?"} → ${names.get(t.dest_account_id ?? "") ?? "?"}`;
                }
                return names.get(t.account_id ?? "") ?? "—";
              }}
            />
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Link
            href="/reports"
            className="inline-flex items-center justify-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
          >
            Lihat laporan bulanan
          </Link>
          <Link
            href="/settings/family"
            className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:border-teal-600 hover:text-teal-800"
          >
            Kelola keluarga
          </Link>
          {!family ? (
            <Link
              href="/join"
              className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-800 hover:border-teal-600 hover:text-teal-800"
            >
              Gabung dengan undangan
            </Link>
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
