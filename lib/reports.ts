/** Util laporan Fase 4: agregat integer dari data otoritatif posted.
 * Tidak ada sistem saldo kedua — semua total diturunkan dari transaksi
 * posted + RPC otoritatif (get_monthly_summary / get_budget_status).
 * Uang selalu BIGINT minor-unit; persen memakai aritmetika integer.
 */

export const REPORT_PAGE_SIZE = 20;
export const REPORT_MAX_LIMIT = 100;
export const REPORT_EXPORT_MAX = 2000;
export const REPORT_MONTH_FETCH_MAX = 5000;

export type ReportKindFilter = "semua" | "income" | "expense" | "transfer";
export type ReportStatusFilter = "semua" | "posted" | "cancelled";

export type ReportFilters = {
  monthFirstDay: string;
  categoryId: string | null;
  accountId: string | null;
  kind: ReportKindFilter;
  status: ReportStatusFilter;
  page: number;
  limit: number;
};

export type CategoryTotal = {
  categoryId: string;
  categoryName: string;
  totalMinor: number;
  count: number;
};

export type MomResult = {
  deltaMinor: number;
  percentInt: number | null;
};

/** Perubahan MoM integer. prev=0 -> percent null (tanpa div-zero). */
export function momChange(current: number, prev: number): MomResult {
  const delta = Number(BigInt(current) - BigInt(prev));
  if (prev === 0) return { deltaMinor: delta, percentInt: null };
  const pct = Number(
    (BigInt(current - prev) * BigInt(100)) / BigInt(prev),
  );
  return { deltaMinor: delta, percentInt: pct };
}

/** Rentang bulan [start, end) dari hari pertama ISO. */
export function monthRange(firstDay: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})-01$/.exec(firstDay);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const end = new Date(Date.UTC(y, mo, 1));
  const yy = end.getUTCFullYear();
  const mm = String(end.getUTCMonth() + 1).padStart(2, "0");
  return { start: firstDay, end: `${yy}-${mm}-01` };
}

type TxLike = {
  kind: "income" | "expense" | "transfer";
  status: "posted" | "cancelled";
  amount_minor: number;
  category_id: string | null;
  account_id: string | null;
  source_account_id: string | null;
  dest_account_id: string | null;
  occurred_at: string;
};

/** Total arus kas posted: income/expense saja, transfer + voided dikecualikan. */
export function summarizePosted(rows: TxLike[]): {
  income: number;
  expense: number;
  net: number;
} {
  let inc = BigInt(0);
  let exp = BigInt(0);
  for (const t of rows) {
    if (t.status !== "posted") continue;
    if (t.kind === "income") inc += BigInt(t.amount_minor);
    else if (t.kind === "expense") exp += BigInt(t.amount_minor);
  }
  return {
    income: Number(inc),
    expense: Number(exp),
    net: Number(inc - exp),
  };
}

/** Distribusi beban per kategori dari posted expense bulan itu. */
export function aggregateExpenseByCategory(
  rows: TxLike[],
  categoryName: (id: string | null) => string,
): CategoryTotal[] {
  const map = new Map<string, { total: bigint; count: number }>();
  for (const t of rows) {
    if (t.status !== "posted" || t.kind !== "expense") continue;
    const key = t.category_id ?? "tanpa-kategori";
    const cur = map.get(key) ?? { total: BigInt(0), count: 0 };
    cur.total += BigInt(t.amount_minor);
    cur.count += 1;
    map.set(key, cur);
  }
  const out: CategoryTotal[] = [];
  for (const [categoryId, v] of map) {
    out.push({
      categoryId,
      categoryName: categoryName(categoryId),
      totalMinor: Number(v.total),
      count: v.count,
    });
  }
  out.sort((a, b) => b.totalMinor - a.totalMinor);
  return out;
}

export function topFive(rows: CategoryTotal[]): CategoryTotal[] {
  return rows.slice(0, 5);
}

/** Filter sisi-klien untuk unit test (cerminan filter server). */
export function filterTransactions<T extends TxLike & { id: string }>(
  rows: T[],
  f: { categoryId?: string | null; accountId?: string | null; kind?: ReportKindFilter; status?: ReportStatusFilter },
): T[] {
  return rows.filter((t) => {
    if (f.kind && f.kind !== "semua" && t.kind !== f.kind) return false;
    if (f.status && f.status !== "semua" && t.status !== f.status) return false;
    if (f.categoryId && t.category_id !== f.categoryId) return false;
    if (f.accountId) {
      const hit =
        t.account_id === f.accountId ||
        t.source_account_id === f.accountId ||
        t.dest_account_id === f.accountId;
      if (!hit) return false;
    }
    return true;
  });
}

export function paginate<T>(rows: T[], page: number, limit: number): T[] {
  const p = Math.max(1, page);
  const l = Math.min(Math.max(1, limit), REPORT_MAX_LIMIT);
  return rows.slice((p - 1) * l, p * l);
}

/** Escape sel CSV (RFC 4180) + cegah formula injection (=,+,-,@). */
export function sanitizeCsvCell(raw: string): string {
  let v = raw;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  const needsQuote = /[",\n\r]/.test(v);
  if (needsQuote) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export type CsvRow = {
  occurred_at: string;
  kind: string;
  account: string;
  category: string;
  amount_minor: number;
  status: string;
  note: string;
};

/** Bangun CSV laporan: tanggal ISO konsisten, nominal integer mentah (akurat IDR). */
export function buildTransactionCsv(rows: CsvRow[]): string {
  const header = [
    "tanggal",
    "jenis",
    "akun",
    "kategori",
    "nominal_minor",
    "status",
    "catatan",
  ].join(",");
  const lines = rows.map((r) =>
    [
      sanitizeCsvCell(r.occurred_at),
      sanitizeCsvCell(r.kind),
      sanitizeCsvCell(r.account),
      sanitizeCsvCell(r.category),
      String(Number.isInteger(r.amount_minor) ? r.amount_minor : 0),
      sanitizeCsvCell(r.status),
      sanitizeCsvCell(r.note ?? ""),
    ].join(","),
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

/** Parse query laporan dengan batas aman (tidak pernah percaya ID keluarga klien). */
export function parseReportFilters(sp: {
  bulan?: string;
  kategori?: string;
  akun?: string;
  jenis?: string;
  status?: string;
  hal?: string;
  batas?: string;
}): ReportFilters | { error: string } {
  const rawMonth = (sp.bulan ?? "").trim();
  let monthFirstDay: string;
  if (rawMonth === "") {
    const now = new Date();
    monthFirstDay = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  } else {
    const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(rawMonth);
    if (!m) return { error: "Bulan harus format YYYY-MM." };
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12)
      return { error: "Bulan harus antara 2000-01 dan 2100-12." };
    monthFirstDay = `${m[1]}-${m[2]}-01`;
  }
  const kind = (sp.jenis ?? "semua").trim().toLowerCase();
  if (kind !== "semua" && kind !== "income" && kind !== "expense" && kind !== "transfer")
    return { error: "Jenis tidak valid." };
  const status = (sp.status ?? "semua").trim().toLowerCase();
  if (status !== "semua" && status !== "posted" && status !== "cancelled")
    return { error: "Status tidak valid." };
  const page = Math.max(1, Number.parseInt(sp.hal ?? "1", 10) || 1);
  const limitRaw = Number.parseInt(sp.batas ?? String(REPORT_PAGE_SIZE), 10) || REPORT_PAGE_SIZE;
  const limit = Math.min(Math.max(1, limitRaw), REPORT_MAX_LIMIT);
  const uuidRe = /^[0-9a-fA-F-]{36}$/;
  const kategori = (sp.kategori ?? "").trim();
  const akun = (sp.akun ?? "").trim();
  if (kategori !== "" && kategori !== "semua" && !uuidRe.test(kategori))
    return { error: "Kategori tidak valid." };
  if (akun !== "" && akun !== "semua" && !uuidRe.test(akun))
    return { error: "Akun tidak valid." };
  return {
    monthFirstDay,
    categoryId: kategori === "" || kategori === "semua" ? null : kategori,
    accountId: akun === "" || akun === "semua" ? null : akun,
    kind: kind as ReportKindFilter,
    status: status as ReportStatusFilter,
    page,
    limit,
  };
}
