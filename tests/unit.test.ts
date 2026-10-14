import { describe, expect, it } from "vitest";
import {
  computeInviteExpiry,
  generateInviteToken,
  hashInviteToken,
  isInviteExpired,
  isValidTokenHashFormat,
  normalizeInviteToken,
} from "@/lib/invite";
import {
  validateAccountName,
  validateAmountMinor,
  validateBudgetLimit,
  validateBudgetMonth,
  validateCategoryKind,
  validateCategoryName,
  validateContributionAmount,
  validateCurrency,
  validateEmail,
  validateFamilyName,
  validateFullName,
  validateGoalDescription,
  validateGoalName,
  validateGoalTarget,
  validateGoalTargetDate,
  validateIdempotencyKey,
  validateNote,
  validateOccurredDate,
  validateOpeningMinor,
  validatePassword,
} from "@/lib/validation";
import {
  budgetRemaining,
  budgetStatus,
  budgetUsagePercent,
  computeAccountBalance,
  firstDayOfMonthIso,
  formatMinor,
  generateIdempotencyKey,
  monthLabelId,
  monthlyNet,
  parseMinorInput,
  shiftMonthIso,
  sumMinors,
} from "@/lib/money";
import {
  estimatedMonthlyContribution,
  goalProgressLabel,
  goalProgressPercent,
  goalRemaining,
  monthsLeftToTarget,
  sumPostedContributions,
} from "@/lib/savings";
import {
  aggregateExpenseByCategory,
  buildTransactionCsv,
  filterTransactions,
  momChange,
  monthRange,
  paginate,
  parseReportFilters,
  sanitizeCsvCell,
  summarizePosted,
  topFive,
} from "@/lib/reports";

describe("util undangan", () => {
  it("membuat token acak unik dan hash SHA-256 yang stabil", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
    expect(hashInviteToken(a)).toBe(hashInviteToken(a));
    expect(hashInviteToken(a)).not.toBe(hashInviteToken(b));
  });

  it("hash selalu 64 hex lowercase", () => {
    expect(isValidTokenHashFormat(hashInviteToken("abc"))).toBe(true);
    expect(isValidTokenHashFormat("tidak-valid")).toBe(false);
  });

  it("menolak format hash yang salah", () => {
    expect(isValidTokenHashFormat("")).toBe(false);
    expect(isValidTokenHashFormat("Z".repeat(64))).toBe(false);
  });

  it("menghitung kedaluwarsa dengan batas 1–168 jam", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(computeInviteExpiry(72, from).toISOString()).toBe(
      "2026-01-04T00:00:00.000Z",
    );
    // Melebihi batas -> dijepit ke 168 jam.
    expect(computeInviteExpiry(9999, from).getTime()).toBe(
      from.getTime() + 168 * 3_600_000,
    );
  });

  it("mendeteksi kedaluwarsa", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    expect(isInviteExpired("2026-01-01T00:00:00Z", now)).toBe(true);
    expect(isInviteExpired("2026-01-03T00:00:00Z", now)).toBe(false);
  });

  it("merapikan token tanpa mencatatnya", () => {
    expect(normalizeInviteToken("  abc  def\n")).toBe("abcdef");
  });
});

describe("validasi input", () => {
  it("email", () => {
    expect(validateEmail("a@b.co")).toBeNull();
    expect(validateEmail("salah")).not.toBeNull();
  });
  it("kata sandi", () => {
    expect(validatePassword("rahasia-123")).toBeNull();
    expect(validatePassword("pendek")).not.toBeNull();
  });
  it("nama", () => {
    expect(validateFullName("Budi")).toBeNull();
    expect(validateFullName("x")).not.toBeNull();
    expect(validateFamilyName("Keluarga Budi")).toBeNull();
  });
  it("mata uang", () => {
    expect(validateCurrency("IDR")).toBeNull();
    expect(validateCurrency("id")).not.toBeNull();
  });

  it("menolak next terbuka pada callback (open-redirect)", () => {
    const sanitize = (raw: string) =>
      raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
    expect(sanitize("/dashboard")).toBe("/dashboard");
    expect(sanitize("https://evil.example/phish")).toBe("/dashboard");
    expect(sanitize("//evil.example/x")).toBe("/dashboard");
  });

  it("token 32 byte di ruang 256-bit (tidak bisa ditebak)", () => {
    for (let i = 0; i < 5; i++) {
      const raw = generateInviteToken();
      // 32 byte base64url -> 43 karakter tanpa padding.
      expect(raw).toHaveLength(43);
      // Hash yang disimpan tidak membocorkan token mentah.
      const h = hashInviteToken(raw);
      expect(h).not.toContain(raw.slice(0, 8));
      expect(isValidTokenHashFormat(h)).toBe(true);
    }
  });

  it("normalisasi tidak mengubah makna token (spasi disisipkan diabaikan)", () => {
    const raw = generateInviteToken();
    const spaced = `${raw.slice(0, 10)} ${raw.slice(10)}`;
    expect(hashInviteToken(normalizeInviteToken(spaced))).toBe(
      hashInviteToken(raw),
    );
  });
});

describe("ledger minor-unit (Fase 2)", () => {
  it("parse input pengguna tanpa float", () => {
    expect(parseMinorInput("50.000")).toBe(50000);
    expect(parseMinorInput("Rp 1.500.000")).toBe(1500000);
    expect(parseMinorInput("0")).toBe(0);
    expect(parseMinorInput("")).toBeNull();
    expect(parseMinorInput("abc")).toBeNull();
    // Batas aman: maksimal 16 digit agar tetap safe integer.
    expect(parseMinorInput("9".repeat(17))).toBeNull();
  });

  it("saldo akun = opening + income - expense + in - out", () => {
    expect(
      computeAccountBalance({
        opening: 100_000,
        income: 50_000,
        expense: 20_000,
        transferIn: 10_000,
        transferOut: 5_000,
      }),
    ).toBe(135_000);
  });

  it("opening balance dihitung walau tanpa transaksi", () => {
    expect(
      computeAccountBalance({
        opening: 250_000,
        income: 0,
        expense: 0,
        transferIn: 0,
        transferOut: 0,
      }),
    ).toBe(250_000);
  });

  it("transfer wealth-neutral pada agregat (total keluarga tetap)", () => {
    const beforeA = computeAccountBalance({
      opening: 100_000,
      income: 0,
      expense: 0,
      transferIn: 0,
      transferOut: 0,
    });
    const beforeB = computeAccountBalance({
      opening: 50_000,
      income: 0,
      expense: 0,
      transferIn: 0,
      transferOut: 0,
    });
    const afterA = computeAccountBalance({
      opening: 100_000,
      income: 0,
      expense: 0,
      transferIn: 0,
      transferOut: 30_000,
    });
    const afterB = computeAccountBalance({
      opening: 50_000,
      income: 0,
      expense: 0,
      transferIn: 30_000,
      transferOut: 0,
    });
    expect(sumMinors([beforeA, beforeB])).toBe(sumMinors([afterA, afterB]));
  });

  it("menolak jumlah tidak valid dan family-id campur (validator)", () => {
    expect(validateAmountMinor(0)).not.toBeNull();
    expect(validateAmountMinor(-5)).not.toBeNull();
    expect(validateAmountMinor(1.5)).not.toBeNull();
    expect(validateAmountMinor(1)).toBeNull();
    expect(validateOpeningMinor(-1)).not.toBeNull();
    expect(validateOpeningMinor(0)).toBeNull();
    expect(validateAccountName(" ")).not.toBeNull();
    expect(validateCategoryName("Gaji")).toBeNull();
    expect(validateCategoryKind("salah")).not.toBeNull();
    expect(validateNote("x".repeat(501))).not.toBeNull();
    expect(validateIdempotencyKey("ok_key-1")).toBeNull();
    expect(validateIdempotencyKey("spasi dilarang")).not.toBeNull();
    expect(validateOccurredDate("1999-12-31")).not.toBeNull();
    // Tanggal kalender fiktif ditolak (tidak roll-over): 2026-02 hanya 28 hari.
    expect(validateOccurredDate("2026-02-30")).not.toBeNull();
    expect(validateOccurredDate("2026-02-28")).toBeNull();
  });

  it("ringkasan bulanan = income - expense (BigInt)", () => {
    expect(monthlyNet(200_000, 75_000)).toBe(125_000);
  });

  it("format minor menghasilkan string mata uang", () => {
    expect(formatMinor(135000, "IDR")).toContain("135");
  });

  it("kunci idempotency unik dan berformat aman", () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).not.toBe(b);
    expect(validateIdempotencyKey(a)).toBeNull();
  });
});

describe("anggaran bulanan (Fase 3)", () => {
  it("validasi batas anggaran memakai minor-unit integer", () => {
    expect(validateBudgetLimit(1)).toBeNull();
    expect(validateBudgetLimit(9_007_199_254_740_991)).toBeNull();
    expect(validateBudgetLimit(0)).not.toBeNull();
    expect(validateBudgetLimit(-5)).not.toBeNull();
    expect(validateBudgetLimit(1.5)).not.toBeNull();
    expect(validateBudgetLimit("1000" as unknown as number)).not.toBeNull();
  });

  it("validasi bulan YYYY-MM dinormalisasi ke hari pertama", () => {
    expect(validateBudgetMonth("2026-10")).toEqual({ firstDay: "2026-10-01" });
    expect(validateBudgetMonth("2026-10-01")).toEqual({ firstDay: "2026-10-01" });
    expect("error" in validateBudgetMonth("Oktober 2026")).toBe(true);
    expect("error" in validateBudgetMonth("2026-13")).toBe(true);
    expect("error" in validateBudgetMonth("1999-12")).toBe(true);
    expect("error" in validateBudgetMonth("2101-01")).toBe(true);
  });

  it("sisa = limit - terpakai dengan BigInt (boleh negatif)", () => {
    expect(budgetRemaining(1_000_000, 250_000)).toBe(750_000);
    expect(budgetRemaining(100_000, 100_000)).toBe(0);
    expect(budgetRemaining(100_000, 120_000)).toBe(-20_000);
  });

  it("persen pemakaian integer tanpa float (floor)", () => {
    expect(budgetUsagePercent(1_000, 800)).toBe(80);
    expect(budgetUsagePercent(1_000, 799)).toBe(79);
    expect(budgetUsagePercent(3, 1)).toBe(33);
    expect(budgetUsagePercent(1_000, 0)).toBe(0);
    expect(budgetUsagePercent(0, 100)).toBe(0);
    expect(budgetUsagePercent(1_000, 1_250)).toBe(125);
  });

  it("status: ok <80%, warning >=80%, over >100%", () => {
    expect(budgetStatus(1_000, 799)).toBe("ok");
    expect(budgetStatus(1_000, 800)).toBe("warning");
    expect(budgetStatus(1_000, 1_000)).toBe("warning");
    expect(budgetStatus(1_000, 1_001)).toBe("over");
  });

  it("navigasi bulan geser hari pertama dan dipertahankan", () => {
    expect(firstDayOfMonthIso("2026-10")).toBe("2026-10-01");
    expect(firstDayOfMonthIso("2026-01-15")).toBe("2026-01-01");
    expect(firstDayOfMonthIso("bulan")).toBeNull();
    expect(shiftMonthIso("2026-10-01", -1)).toBe("2026-09-01");
    expect(shiftMonthIso("2026-01-01", -1)).toBe("2025-12-01");
    expect(shiftMonthIso("2026-12-01", 1)).toBe("2027-01-01");
    expect(shiftMonthIso("2026-10", 1)).toBeNull();
    expect(monthLabelId("2026-10-01")).toBe("Oktober 2026");
  });

  it("terpakai hanya dari posted expense: transfer + cancelled dikecualikan", () => {
    // Simulasi agregat: income 50000, expense posted 20000 + 7000 dibatalkan,
    // transfer 30000 — terpakai kategori Belanja = 20000 saja.
    const postedExpense = [20_000];
    const cancelledExpense = [7_000];
    const transfers = [30_000];
    const spent = postedExpense.reduce((a, b) => a + b, 0);
    expect(spent).toBe(20_000);
    expect(cancelledExpense[0]).toBe(7_000);
    expect(transfers[0]).toBe(30_000);
    expect(budgetRemaining(50_000, spent)).toBe(30_000);
    expect(budgetUsagePercent(50_000, spent)).toBe(40);
    expect(budgetStatus(50_000, spent)).toBe("ok");
  });
});

describe("laporan bulanan (Fase 4)", () => {
  const tx = (
    id: string,
    kind: "income" | "expense" | "transfer",
    status: "posted" | "cancelled",
    amount: number,
    extra: Partial<{
      category_id: string | null;
      account_id: string | null;
      source_account_id: string | null;
      dest_account_id: string | null;
    }> = {},
  ) => ({
    id,
    kind,
    status,
    amount_minor: amount,
    category_id: extra.category_id ?? null,
    account_id: extra.account_id ?? null,
    source_account_id: extra.source_account_id ?? null,
    dest_account_id: extra.dest_account_id ?? null,
    occurred_at: "2026-10-05",
  });

  it("total/bersih: posted income-expense; transfer + voided dikecualikan", () => {
    const rows = [
      tx("1", "income", "posted", 200_000, { account_id: "a1", category_id: "gaji" }),
      tx("2", "expense", "posted", 75_000, { account_id: "a1", category_id: "belanja" }),
      tx("3", "expense", "cancelled", 50_000, { account_id: "a1", category_id: "belanja" }),
      tx("4", "transfer", "posted", 30_000, { source_account_id: "a1", dest_account_id: "a2" }),
    ];
    expect(summarizePosted(rows)).toEqual({
      income: 200_000,
      expense: 75_000,
      net: 125_000,
    });
  });

  it("MoM integer: delta + persen; bulan lalu nol tanpa div-zero", () => {
    expect(momChange(125_000, 100_000)).toEqual({ deltaMinor: 25_000, percentInt: 25 });
    expect(momChange(75_000, 100_000)).toEqual({ deltaMinor: -25_000, percentInt: -25 });
    expect(momChange(0, 0)).toEqual({ deltaMinor: 0, percentInt: null });
    expect(momChange(50_000, 0)).toEqual({ deltaMinor: 50_000, percentInt: null });
    // Floor integer: 1/3 -> 33 (tanpa float).
    expect(momChange(4, 3).percentInt).toBe(33);
  });

  it("breakdown kategori + ranking 5 teratas (posted expense saja)", () => {
    const rows = [
      tx("1", "expense", "posted", 60_000, { category_id: "c-makan" }),
      tx("2", "expense", "posted", 40_000, { category_id: "c-makan" }),
      tx("3", "expense", "posted", 25_000, { category_id: "c-bensin" }),
      tx("4", "expense", "cancelled", 99_000, { category_id: "c-bensin" }),
      tx("5", "income", "posted", 500_000, { category_id: "c-gaji" }),
      tx("6", "transfer", "posted", 10_000, {}),
    ];
    const byCat = aggregateExpenseByCategory(rows, (id) => id ?? "?");
    expect(byCat.map((c) => [c.categoryId, c.totalMinor])).toEqual([
      ["c-makan", 100_000],
      ["c-bensin", 25_000],
    ]);
    expect(topFive([...byCat, ...byCat, ...byCat]).length).toBe(5);
  });

  it("aktual vs anggaran memakai sisa/persen/status otoritatif", () => {
    const spent = aggregateExpenseByCategory(
      [tx("1", "expense", "posted", 85_000, { category_id: "c-belanja" })],
      (id) => id ?? "?",
    )[0]?.totalMinor ?? 0;
    expect(spent).toBe(85_000);
    expect(budgetRemaining(100_000, spent)).toBe(15_000);
    expect(budgetUsagePercent(100_000, spent)).toBe(85);
    expect(budgetStatus(100_000, spent)).toBe("warning");
  });

  it("empty state: tanpa posted -> total nol + breakdown kosong", () => {
    const rows = [
      tx("1", "transfer", "posted", 30_000, {}),
      tx("2", "expense", "cancelled", 10_000, { category_id: "c-x" }),
    ];
    expect(summarizePosted(rows)).toEqual({ income: 0, expense: 0, net: 0 });
    expect(aggregateExpenseByCategory(rows, (id) => id ?? "?")).toEqual([]);
    expect(monthRange("2026-10-01")).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(monthRange("2026-12-01")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("filter + paginasi: jenis/status/kategori/akun + batas aman", () => {
    const rows = [
      tx("1", "expense", "posted", 10_000, { account_id: "a1", category_id: "c1" }),
      tx("2", "transfer", "posted", 20_000, { source_account_id: "a1", dest_account_id: "a2" }),
      tx("3", "income", "posted", 30_000, { account_id: "a2", category_id: "c2" }),
      tx("4", "expense", "cancelled", 40_000, { account_id: "a1", category_id: "c1" }),
    ];
    expect(filterTransactions(rows, { kind: "expense", status: "posted" }).map((t) => t.id)).toEqual(["1"]);
    expect(filterTransactions(rows, { accountId: "a1" }).map((t) => t.id)).toEqual(["1", "2", "4"]);
    expect(filterTransactions(rows, { categoryId: "c9" })).toEqual([]);
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual([3, 4]);
    expect(paginate([1, 2, 3], 5, 2)).toEqual([]);
    expect(paginate([1, 2, 3], 1, 9999).length).toBe(3);
  });

  it("parse filter: batas dijepit + enum + uuid divalidasi + tanpa familyId klien", () => {
    const ok = parseReportFilters({ bulan: "2026-10", jenis: "semua", status: "semua", hal: "2", batas: "50" });
    expect(ok).toEqual({
      monthFirstDay: "2026-10-01",
      categoryId: null,
      accountId: null,
      kind: "semua",
      status: "semua",
      page: 2,
      limit: 50,
    });
    const clamped = parseReportFilters({ batas: "9999" });
    expect("error" in clamped ? null : clamped.limit).toBe(100);
    expect("error" in parseReportFilters({ jenis: "hutang" })).toBe(true);
    expect("error" in parseReportFilters({ status: "draft" })).toBe(true);
    expect("error" in parseReportFilters({ kategori: "bukan-uuid" })).toBe(true);
    expect("error" in parseReportFilters({ bulan: "1999-12" })).toBe(true);
    // Tidak ada kolom familyId pada hasil parse — keluarga selalu dari sesi server.
    expect("familyId" in (ok as Record<string, unknown>)).toBe(false);
  });

  it("CSV: header konsisten + nominal integer + tanggal ISO + anti formula-injection", () => {
    const csv = buildTransactionCsv([
      {
        occurred_at: "2026-10-05",
        kind: "expense",
        account: "Dompet",
        category: "Belanja",
        amount_minor: 75_000,
        status: "posted",
        note: "=cmd|' /C calc'!A0",
      },
      {
        occurred_at: "2026-10-06",
        kind: "transfer",
        account: "Dompet → Bank",
        category: "Transfer",
        amount_minor: 30_000,
        status: "cancelled",
        note: 'kopi "tubruk", pagi',
      },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("tanggal,jenis,akun,kategori,nominal_minor,status,catatan");
    // Nominal tetap integer mentah (tanpa Rp/titik/koma float).
    expect(lines[1]).toContain(",75000,posted,");
    expect(lines[2]).toContain(",30000,cancelled,");
    // Sel berbahaya diawali ' agar tidak dieksekusi sebagai formula.
    expect(lines[1].endsWith(",'=cmd|' /C calc'!A0")).toBe(true);
    // Koma/kutip di-escape RFC 4180.
    expect(lines[2]).toContain('"kopi ""tubruk"", pagi"');
    expect(sanitizeCsvCell("@evil")).toBe("'@evil");
    expect(sanitizeCsvCell("+1+1")).toBe("'+1+1");
    expect(sanitizeCsvCell("-2")).toBe("'-2");
    expect(sanitizeCsvCell("normal")).toBe("normal");
  });
});

describe("tujuan tabungan (Fase 5)", () => {
  it("validasi nama/target/deskripsi/tanggal tujuan", () => {
    expect(validateGoalName("Dana darurat")).toBeNull();
    expect(validateGoalName(" ")).not.toBeNull();
    expect(validateGoalName("x".repeat(81))).not.toBeNull();
    expect(validateGoalTarget(1)).toBeNull();
    expect(validateGoalTarget(0)).not.toBeNull();
    expect(validateGoalTarget(1.5)).not.toBeNull();
    expect(validateGoalTarget(9_007_199_254_740_992)).not.toBeNull();
    expect(validateGoalDescription(null)).toBeNull();
    expect(validateGoalDescription("x".repeat(501))).not.toBeNull();
    expect(validateGoalTargetDate(null)).toEqual({ date: null });
    expect(validateGoalTargetDate("")).toEqual({ date: null });
    expect(validateGoalTargetDate("2027-06-01")).toEqual({ date: "2027-06-01" });
    expect("error" in validateGoalTargetDate("01-06-2027")).toBe(true);
    expect("error" in validateGoalTargetDate("1999-12-31")).toBe(true);
    expect("error" in validateGoalTargetDate("2101-01-01")).toBe(true);
    expect(validateContributionAmount(1)).toBeNull();
    expect(validateContributionAmount(0)).not.toBeNull();
  });

  it("sisa = target - terkumpul dengan BigInt (boleh negatif)", () => {
    expect(goalRemaining(1_000_000, 250_000)).toBe(750_000);
    expect(goalRemaining(100_000, 100_000)).toBe(0);
    expect(goalRemaining(100_000, 120_000)).toBe(-20_000);
  });

  it("persen progres integer floor; nol aman; >100 diizinkan", () => {
    expect(goalProgressPercent(1_000, 800)).toBe(80);
    expect(goalProgressPercent(3, 1)).toBe(33);
    expect(goalProgressPercent(1_000, 0)).toBe(0);
    expect(goalProgressPercent(0, 100)).toBe(0);
    expect(goalProgressPercent(1_000, 1_250)).toBe(125);
    expect(goalProgressLabel(1_000, 0)).toBe("belum-mulai");
    expect(goalProgressLabel(1_000, 500)).toBe("berjalan");
    expect(goalProgressLabel(1_000, 1_000)).toBe("tercapai");
    expect(goalProgressLabel(1_000, 1_001)).toBe("terlampaui");
  });

  it("terkumpul hanya dari posted: cancelled dikecualikan (bukan ledger)", () => {
    expect(
      sumPostedContributions([
        { status: "posted", amount_minor: 200_000 },
        { status: "cancelled", amount_minor: 50_000 },
        { status: "posted", amount_minor: 75_000 },
      ]),
    ).toBe(275_000);
    expect(summarizePosted([])).toEqual({ income: 0, expense: 0, net: 0 });
  });

  it("estimasi iuran bulanan ceil; tanpa tanggal -> null", () => {
    expect(estimatedMonthlyContribution(900_000, 3)).toBe(300_000);
    expect(estimatedMonthlyContribution(1_000_000, 3)).toBe(333_334);
    expect(estimatedMonthlyContribution(0, 3)).toBe(0);
    expect(estimatedMonthlyContribution(100_000, 0)).toBe(100_000);
    expect(estimatedMonthlyContribution(100_000, null)).toBeNull();
  });

  it("sisa bulan kalender inklusif; lewat -> 0; tanpa tanggal -> null", () => {
    expect(monthsLeftToTarget(null)).toBeNull();
    expect(monthsLeftToTarget("2026-10-15", "2026-10-01")).toBe(1);
    expect(monthsLeftToTarget("2026-12-01", "2026-10-15")).toBe(3);
    expect(monthsLeftToTarget("2026-09-01", "2026-10-15")).toBe(0);
    expect(monthsLeftToTarget("salah", "2026-10-15")).toBeNull();
  });
});
