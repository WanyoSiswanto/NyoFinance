import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth-server";
import { PageShell } from "@/components/layout";
import { LogoutButton } from "@/components/logout-button";
import { Alert, Card } from "@/components/ui";
import {
  CategoryBars,
  MonthlyOverviewCards,
  ReportMonthNav,
} from "@/components/reports";
import {
  REPORT_MONTH_FETCH_MAX,
  aggregateExpenseByCategory,
  momChange,
  monthRange,
  paginate,
  parseReportFilters,
  topFive,
} from "@/lib/reports";
import {
  budgetRemaining,
  budgetStatus,
  budgetUsagePercent,
  formatMinor,
  monthLabelId,
  shiftMonthIso,
} from "@/lib/money";
import type {
  Account,
  BudgetStatus as BudgetStatusRow,
  Category,
  Family,
  FamilyMember,
  MonthlySummary,
  Transaction,
} from "@/lib/database.types";

export const dynamic = "force-dynamic";

type MembershipRow = FamilyMember & { families: Family | null };
type SP = {
  bulan?: string;
  kategori?: string;
  akun?: string;
  jenis?: string;
  status?: string;
  hal?: string;
  batas?: string;
};

function qs(params: Record<string, string>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== "") q.set(k, v);
  }
  return q.toString();
}

function kindLabel(kind: string): string {
  if (kind === "income") return "Pemasukan";
  if (kind === "expense") return "Pengeluaran";
  return "Transfer";
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: Promise<SP>;
}) {
  const { supabase, user } = await getAuthContext();
  if (!user || !supabase) redirect("/login");

  const sp = (await searchParams) ?? {};
  const parsed = parseReportFilters({
    bulan: typeof sp.bulan === "string" ? sp.bulan : "",
    kategori: typeof sp.kategori === "string" ? sp.kategori : "",
    akun: typeof sp.akun === "string" ? sp.akun : "",
    jenis: typeof sp.jenis === "string" ? sp.jenis : "",
    status: typeof sp.status === "string" ? sp.status : "",
    hal: typeof sp.hal === "string" ? sp.hal : "",
    batas: typeof sp.batas === "string" ? sp.batas : "",
  });

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
            <h1 className="text-2xl font-bold tracking-tight">Laporan</h1>
            <p className="mt-1 text-sm text-stone-600">
              Buat keluarga atau gabung dengan undangan untuk melihat laporan.
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

  if ("error" in parsed) {
    return (
      <PageShell email={user.email} action={<LogoutButton />}>
        <div className="space-y-6">
          <h1 className="text-2xl font-bold tracking-tight">Laporan</h1>
          <Alert kind="error">{parsed.error}</Alert>
          <Link
            href="/reports"
            className="text-sm font-semibold text-teal-800 hover:underline"
          >
            Atur ulang filter
          </Link>
        </div>
      </PageShell>
    );
  }

  const filters = parsed;
  const range = monthRange(filters.monthFirstDay);
  const prevFirstDay = shiftMonthIso(filters.monthFirstDay, -1);
  const prevRange = prevFirstDay ? monthRange(prevFirstDay) : null;
  if (!range) {
    return (
      <PageShell email={user.email} action={<LogoutButton />}>
        <Alert kind="error">Bulan tidak valid.</Alert>
      </PageShell>
    );
  }

  const year = Number(filters.monthFirstDay.slice(0, 4));
  const month = Number(filters.monthFirstDay.slice(5, 7));

  // Akun + kategori milik keluarga (sumber nama tampilan + opsi filter).
  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id,family_id,name,opening_balance_minor,created_by,created_at,updated_at")
    .eq("family_id", row.family_id)
    .order("name", { ascending: true });
  const accounts = (accountRows ?? []) as Account[];
  const { data: categoryRows } = await supabase
    .from("categories")
    .select("id,family_id,name,kind,created_by,created_at")
    .eq("family_id", row.family_id)
    .order("name", { ascending: true });
  const categories = (categoryRows ?? []) as Category[];
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const accountLabel = (t: Transaction): string => {
    if (t.kind === "transfer") {
      const s = accountNames.get(t.source_account_id ?? "") ?? "?";
      const d = accountNames.get(t.dest_account_id ?? "") ?? "?";
      return `${s} → ${d}`;
    }
    return accountNames.get(t.account_id ?? "") ?? "—";
  };
  const categoryLabel = (t: Transaction): string => {
    if (t.kind === "transfer") return "Transfer";
    return categoryNames.get(t.category_id ?? "") ?? "—";
  };

  // Ringkasan otoritatif via RPC (posted saja, transfer dikecualikan).
  const { data: curRows } = await supabase.rpc("get_monthly_summary", {
    p_family_id: row.family_id,
    p_year: year,
    p_month: month,
  });
  const cur = (Array.isArray(curRows) ? curRows[0] : curRows) as MonthlySummary | null;
  let prev: MonthlySummary | null = null;
  if (prevFirstDay) {
    const { data: prevRows } = await supabase.rpc("get_monthly_summary", {
      p_family_id: row.family_id,
      p_year: Number(prevFirstDay.slice(0, 4)),
      p_month: Number(prevFirstDay.slice(5, 7)),
    });
    prev = (Array.isArray(prevRows) ? prevRows[0] : prevRows) as MonthlySummary | null;
  }
  const income = cur?.income_total_minor ?? 0;
  const expense = cur?.expense_total_minor ?? 0;
  const net = cur?.net_minor ?? income - expense;
  const prevIncome = prev?.income_total_minor ?? 0;
  const prevExpense = prev?.expense_total_minor ?? 0;
  const prevNet = prev?.net_minor ?? prevIncome - prevExpense;

  // Agregat kategori dari SELECT RLS (definisi sama: posted expense).
  // Indeks idx_tx_family_occurred melayani rentang bulan + urutan.
  const { data: monthTxRows } = await supabase
    .from("transactions")
    .select(
      "id,kind,status,amount_minor,category_id,account_id,source_account_id,dest_account_id,occurred_at",
    )
    .eq("family_id", row.family_id)
    .gte("occurred_at", range.start)
    .lt("occurred_at", range.end)
    .limit(REPORT_MONTH_FETCH_MAX);
  const monthTxs = (monthTxRows ?? []) as Pick<
    Transaction,
    | "id"
    | "kind"
    | "status"
    | "amount_minor"
    | "category_id"
    | "account_id"
    | "source_account_id"
    | "dest_account_id"
    | "occurred_at"
  >[];
  let prevTxs: typeof monthTxs = [];
  if (prevRange) {
    const { data: prevTxRows } = await supabase
      .from("transactions")
      .select(
        "id,kind,status,amount_minor,category_id,account_id,source_account_id,dest_account_id,occurred_at",
      )
      .eq("family_id", row.family_id)
      .gte("occurred_at", prevRange.start)
      .lt("occurred_at", prevRange.end)
      .limit(REPORT_MONTH_FETCH_MAX);
    prevTxs = (prevTxRows ?? []) as typeof monthTxs;
  }
  const byCat = aggregateExpenseByCategory(monthTxs, (id) =>
    id === "tanpa-kategori" ? "Tanpa kategori" : (categoryNames.get(id ?? "") ?? "Kategori dihapus"),
  );
  const prevByCat = aggregateExpenseByCategory(prevTxs, (id) =>
    id === "tanpa-kategori" ? "Tanpa kategori" : (categoryNames.get(id ?? "") ?? "Kategori dihapus"),
  );
  const top5 = topFive(byCat);

  // Perbandingan MoM per kategori: gabungan bulan berjalan + lalu.
  const prevMap = new Map(prevByCat.map((c) => [c.categoryId, c]));
  const momRows = byCat.map((c) => {
    const p = prevMap.get(c.categoryId)?.totalMinor ?? 0;
    return { ...c, prevMinor: p, mom: momChange(c.totalMinor, p) };
  });
  for (const p of prevByCat) {
    if (!byCat.some((c) => c.categoryId === p.categoryId)) {
      momRows.push({ ...p, totalMinor: 0, count: 0, prevMinor: p.totalMinor, mom: momChange(0, p.totalMinor) });
    }
  }
  momRows.sort((a, b) => b.totalMinor - a.totalMinor);
  const momTop = momRows.slice(0, 10);

  // Anggaran vs aktual otoritatif via get_budget_status (spent = posted expense).
  const { data: budgetRows } = await supabase.rpc("get_budget_status", {
    p_family_id: row.family_id,
    p_year: year,
    p_month: month,
  });
  const budgets = (budgetRows ?? []) as BudgetStatusRow[];

  // Daftar transaksi berfilter + paginasi (server-side, batas aman).
  const baseForList = () => {
    let q = supabase
      .from("transactions")
      .select(
        "id,family_id,kind,amount_minor,account_id,category_id,source_account_id,dest_account_id,note,occurred_at,status,cancelled_at,cancelled_by,idempotency_key,created_by,created_at",
        { count: "exact" },
      )
      .eq("family_id", row.family_id)
      .gte("occurred_at", range.start)
      .lt("occurred_at", range.end);
    if (filters.categoryId) q = q.eq("category_id", filters.categoryId);
    if (filters.kind !== "semua") q = q.eq("kind", filters.kind);
    if (filters.status !== "semua") q = q.eq("status", filters.status);
    if (filters.accountId) {
      const a = filters.accountId;
      q = q.or(`account_id.eq.${a},source_account_id.eq.${a},dest_account_id.eq.${a}`);
    }
    return q;
  };
  const { count: totalCount } = await baseForList().limit(1);
  const total = totalCount ?? 0;
  const offset = (filters.page - 1) * filters.limit;
  // Pertahankan urutan yang sama dengan dasbor (idx_tx_family_occurred).
  const listQuery = baseForList()
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + filters.limit - 1);
  const { data: listRows } = await listQuery;
  const list = (listRows ?? []) as Transaction[];
  // Validasi konsistensi: halaman di luar jangkauan -> tampilkan kosong.
  const pageItems = paginate(list, 1, filters.limit);
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));

  const keepBase: Record<string, string> = {
    bulan: filters.monthFirstDay.slice(0, 7),
    kategori: filters.categoryId ?? "",
    akun: filters.accountId ?? "",
    jenis: filters.kind,
    status: filters.status,
    batas: String(filters.limit),
  };
  const navQuery = qs({
    kategori: keepBase.kategori,
    akun: keepBase.akun,
    jenis: keepBase.jenis === "semua" ? "" : keepBase.jenis,
    status: keepBase.status === "semua" ? "" : keepBase.status,
    batas: keepBase.batas === "20" ? "" : keepBase.batas,
  });
  const exportHref = `/reports/export?${qs({
    bulan: keepBase.bulan,
    kategori: keepBase.kategori,
    akun: keepBase.akun,
    jenis: keepBase.jenis,
    status: keepBase.status,
  })}`;
  const pageHref = (p: number) =>
    `/reports?${qs({ ...keepBase, hal: String(p) })}`;

  return (
    <PageShell email={user.email} action={<LogoutButton />}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Laporan</h1>
            <p className="mt-1 text-sm text-stone-600">
              Ringkasan otoritatif dari transaksi posted — transfer tidak
              dihitung sebagai pemasukan/pengeluaran, yang dibatalkan
              dikecualikan dari total.
            </p>
          </div>
          <ReportMonthNav current={filters.monthFirstDay} baseQuery={navQuery} />
        </div>

        <div className="flex flex-wrap gap-3 text-sm">
          <Link
            href="/dashboard"
            className="font-semibold text-teal-800 hover:underline"
          >
            ← Kembali ke dasbor
          </Link>
          <span className="text-stone-400">·</span>
          <span className="text-stone-600">{monthLabelId(filters.monthFirstDay)}</span>
        </div>

        <section aria-label="Ringkasan bulanan" className="space-y-3">
          <h2 className="text-lg font-semibold">Ringkasan {monthLabelId(filters.monthFirstDay)}</h2>
          <MonthlyOverviewCards
            income={income}
            expense={expense}
            net={net}
            momIncome={momChange(income, prevIncome)}
            momExpense={momChange(expense, prevExpense)}
            momNet={momChange(net, prevNet)}
            currency={family.currency}
          />
          {income === 0 && expense === 0 ? (
            <p className="text-sm text-stone-500">
              Belum ada pemasukan/pengeluaran posted bulan ini. Transfer dan
              transaksi yang dibatalkan tidak masuk ringkasan.
            </p>
          ) : null}
        </section>

        <Card
          title="Distribusi pengeluaran per kategori"
          description="Dari posted expense bulan ini. Transfer, pemasukan, dan yang dibatalkan dikecualikan."
        >
          <CategoryBars rows={byCat} total={expense} currency={family.currency} />
          {top5.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-stone-800">5 Teratas</h3>
              <ol className="mt-2 space-y-1 text-sm">
                {top5.map((t, i) => (
                  <li key={t.categoryId} className="flex justify-between gap-2">
                    <span className="text-stone-700">
                      {i + 1}. {t.categoryName}
                    </span>
                    <span className="tabular-nums font-semibold">
                      {formatMinor(t.totalMinor, family.currency)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </Card>

        <Card
          title="Perbandingan MoM per kategori"
          description="Bulan berjalan vs bulan lalu (posted expense). Bulan lalu Rp0 berarti tanpa persen (tanpa pembagian nol)."
        >
          {momTop.length === 0 ? (
            <p className="text-sm text-stone-500">
              Belum ada data kategori untuk dibandingkan.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-xl text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs text-stone-500 uppercase">
                    <th className="py-2 pr-3 font-semibold">Kategori</th>
                    <th className="py-2 pr-3 text-right font-semibold">Bulan ini</th>
                    <th className="py-2 pr-3 text-right font-semibold">Bulan lalu</th>
                    <th className="py-2 text-right font-semibold">Δ MoM</th>
                  </tr>
                </thead>
                <tbody>
                  {momTop.map((m) => (
                    <tr key={m.categoryId} className="border-b border-stone-100 last:border-0">
                      <td className="py-2 pr-3 font-medium">{m.categoryName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMinor(m.totalMinor, family.currency)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums text-stone-600">
                        {formatMinor(m.prevMinor, family.currency)}
                      </td>
                      <td className="py-2 text-right text-xs tabular-nums text-stone-600">
                        {m.mom.percentInt === null
                          ? `${formatMinor(m.mom.deltaMinor, family.currency)} (tanpa %)`
                          : `${formatMinor(m.mom.deltaMinor, family.currency)} · ${m.mom.percentInt}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Aktual vs anggaran"
          description="Aktual (terpakai) dari get_budget_status — otoritatif, sama dengan dasbor."
        >
          {budgets.length === 0 ? (
            <p className="text-sm text-stone-500">
              Belum ada anggaran untuk {monthLabelId(filters.monthFirstDay)}. Buat
              anggaran lewat dasbor untuk membandingkan aktual vs batas.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-xl text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs text-stone-500 uppercase">
                    <th className="py-2 pr-3 font-semibold">Kategori</th>
                    <th className="py-2 pr-3 text-right font-semibold">Batas</th>
                    <th className="py-2 pr-3 text-right font-semibold">Aktual</th>
                    <th className="py-2 pr-3 text-right font-semibold">Sisa</th>
                    <th className="py-2 text-right font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {budgets.map((b) => {
                    const pct = budgetUsagePercent(b.limit_minor, b.spent_minor);
                    const rem = budgetRemaining(b.limit_minor, b.spent_minor);
                    const st = budgetStatus(b.limit_minor, b.spent_minor);
                    return (
                      <tr key={b.budget_id} className="border-b border-stone-100 last:border-0">
                        <td className="py-2 pr-3 font-medium">{b.category_name}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatMinor(b.limit_minor, family.currency)}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatMinor(b.spent_minor, family.currency)} · {pct}%
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {formatMinor(rem, family.currency)}
                        </td>
                        <td className="py-2 text-right text-xs font-semibold">
                          {st === "over" ? (
                            <span className="text-red-700">Over</span>
                          ) : st === "warning" ? (
                            <span className="text-amber-700">≥80%</span>
                          ) : (
                            <span className="text-teal-800">OK</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title={`Transaksi ${monthLabelId(filters.monthFirstDay)}`}
          description="Filter tanggal/kategori/akun/jenis. Transfer tampil sebagai Transfer (bukan pemasukan/pengeluaran). Yang dibatalkan diberi label dan tetap tampil bila filter status mengizinkan."
        >
          <form method="GET" action="/reports" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="text-xs font-semibold text-stone-700">
              Bulan
              <input
                type="month"
                name="bulan"
                defaultValue={filters.monthFirstDay.slice(0, 7)}
                min="2000-01"
                max="2100-12"
                className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-semibold text-stone-700">
              Kategori
              <select
                name="kategori"
                defaultValue={filters.categoryId ?? ""}
                className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal"
              >
                <option value="">Semua</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.kind})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-stone-700">
              Akun
              <select
                name="akun"
                defaultValue={filters.accountId ?? ""}
                className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal"
              >
                <option value="">Semua</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-stone-700">
              Jenis
              <select
                name="jenis"
                defaultValue={filters.kind}
                className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal"
              >
                <option value="semua">Semua</option>
                <option value="income">Pemasukan</option>
                <option value="expense">Pengeluaran</option>
                <option value="transfer">Transfer</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-stone-700">
              Status
              <select
                name="status"
                defaultValue={filters.status}
                className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal"
              >
                <option value="semua">Semua</option>
                <option value="posted">Tercatat</option>
                <option value="cancelled">Dibatalkan</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-stone-700">
              Per halaman
              <select
                name="batas"
                defaultValue={String(filters.limit)}
                className="mt-1 block w-full rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-sm font-normal"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2 sm:col-span-3 lg:col-span-6">
              <button
                type="submit"
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Terapkan filter
              </button>
              <Link
                href="/reports"
                className="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:border-teal-600 hover:text-teal-800"
              >
                Atur ulang
              </Link>
              <a
                href={exportHref}
                className="rounded-lg border border-teal-700 bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-900 hover:bg-teal-100"
              >
                Ekspor CSV ({total} baris)
              </a>
            </div>
          </form>

          <p className="mt-4 text-xs text-stone-500">
            {total} transaksi cocok · halaman {filters.page} dari {totalPages}
          </p>
          {pageItems.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">
              Tidak ada transaksi yang cocok dengan filter ini.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {pageItems.map((t) => (
                <li
                  key={t.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-900">
                      {kindLabel(t.kind)} · {formatMinor(t.amount_minor, family.currency)}{" "}
                      {t.status === "cancelled" ? (
                        <span className="ml-1 rounded-full bg-stone-200 px-2 py-0.5 text-[11px] font-bold text-stone-700">
                          Dibatalkan
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-stone-500">
                      {t.occurred_at} · {accountLabel(t)} · {categoryLabel(t)}
                      {t.note ? ` · ${t.note}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex items-center gap-2 text-sm">
            <Link
              aria-disabled={filters.page <= 1}
              href={filters.page <= 1 ? "#" : pageHref(filters.page - 1)}
              className={`rounded-lg border px-3 py-1.5 font-semibold ${filters.page <= 1 ? "cursor-not-allowed border-stone-200 text-stone-400" : "border-stone-300 text-stone-700 hover:border-teal-600 hover:text-teal-800"}`}
            >
              ‹ Sebelumnya
            </Link>
            <span className="text-xs text-stone-500">
              Hal {filters.page} / {totalPages}
            </span>
            <Link
              aria-disabled={filters.page >= totalPages}
              href={filters.page >= totalPages ? "#" : pageHref(filters.page + 1)}
              className={`rounded-lg border px-3 py-1.5 font-semibold ${filters.page >= totalPages ? "cursor-not-allowed border-stone-200 text-stone-400" : "border-stone-300 text-stone-700 hover:border-teal-600 hover:text-teal-800"}`}
            >
              Berikutnya ›
            </Link>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
