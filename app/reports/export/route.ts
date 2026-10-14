import { getAuthContext } from "@/lib/auth-server";
import {
  REPORT_EXPORT_MAX,
  buildTransactionCsv,
  monthRange,
  parseReportFilters,
} from "@/lib/reports";
import type {
  Account,
  Category,
  Family,
  FamilyMember,
  Transaction,
} from "@/lib/database.types";

export const dynamic = "force-dynamic";

type MembershipRow = FamilyMember & { families: Family | null };

/** Ekspor CSV transaksi berfilter: otorisasi keluarga + filter aktif.
 * Nominal = integer minor mentah (akurat IDR), tanggal ISO YYYY-MM-DD,
 * sel disanitasi dari formula injection (=,+,-,@).
 */
export async function GET(request: Request) {
  const { supabase, user } = await getAuthContext();
  if (!user || !supabase) {
    return new Response("Unauthorized", { status: 401 });
  }
  const url = new URL(request.url);
  const parsed = parseReportFilters({
    bulan: url.searchParams.get("bulan") ?? "",
    kategori: url.searchParams.get("kategori") ?? "",
    akun: url.searchParams.get("akun") ?? "",
    jenis: url.searchParams.get("jenis") ?? "",
    status: url.searchParams.get("status") ?? "",
    hal: "1",
    batas: "20",
  });
  if ("error" in parsed) {
    return new Response(parsed.error, { status: 400 });
  }
  const range = monthRange(parsed.monthFirstDay);
  if (!range) return new Response("Bulan tidak valid.", { status: 400 });

  const { data: membership } = await supabase
    .from("family_members")
    .select(
      "family_id,user_id,role,status,joined_at,families(id,name,currency,created_at,updated_at,created_by)",
    )
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  const row = membership as unknown as MembershipRow | null;
  if (!row) return new Response("Forbidden", { status: 403 });

  // Family ID selalu dari membership server — tidak pernah dari klien.
  let q = supabase
    .from("transactions")
    .select(
      "id,kind,amount_minor,account_id,category_id,source_account_id,dest_account_id,note,occurred_at,status",
    )
    .eq("family_id", row.family_id)
    .gte("occurred_at", range.start)
    .lt("occurred_at", range.end)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(REPORT_EXPORT_MAX);
  if (parsed.categoryId) q = q.eq("category_id", parsed.categoryId);
  if (parsed.kind !== "semua") q = q.eq("kind", parsed.kind);
  if (parsed.status !== "semua") q = q.eq("status", parsed.status);
  if (parsed.accountId) {
    const a = parsed.accountId;
    q = q.or(`account_id.eq.${a},source_account_id.eq.${a},dest_account_id.eq.${a}`);
  }
  const { data: txRows, error } = await q;
  if (error) return new Response("Gagal mengekspor.", { status: 500 });
  const txs = (txRows ?? []) as Pick<
    Transaction,
    | "kind"
    | "amount_minor"
    | "account_id"
    | "category_id"
    | "source_account_id"
    | "dest_account_id"
    | "note"
    | "occurred_at"
    | "status"
  >[];

  const { data: accountRows } = await supabase
    .from("accounts")
    .select("id,name")
    .eq("family_id", row.family_id);
  const { data: categoryRows } = await supabase
    .from("categories")
    .select("id,name")
    .eq("family_id", row.family_id);
  const accountNames = new Map(
    ((accountRows ?? []) as Pick<Account, "id" | "name">[]).map((a) => [a.id, a.name]),
  );
  const categoryNames = new Map(
    ((categoryRows ?? []) as Pick<Category, "id" | "name">[]).map((c) => [c.id, c.name]),
  );

  const csv = buildTransactionCsv(
    txs.map((t) => {
      const account =
        t.kind === "transfer"
          ? `${accountNames.get(t.source_account_id ?? "") ?? "?"} → ${accountNames.get(t.dest_account_id ?? "") ?? "?"}`
          : (accountNames.get(t.account_id ?? "") ?? "—");
      const category =
        t.kind === "transfer"
          ? "Transfer"
          : (categoryNames.get(t.category_id ?? "") ?? "—");
      return {
        occurred_at: t.occurred_at,
        kind: t.kind,
        account,
        category,
        amount_minor: t.amount_minor,
        status: t.status,
        note: t.note ?? "",
      };
    }),
  );
  const filename = `nyofinance-${parsed.monthFirstDay.slice(0, 7)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
