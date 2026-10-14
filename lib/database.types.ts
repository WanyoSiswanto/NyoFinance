/** Tipe baris database Fase 1 (ringkas, ditulis manual). */

export type Profile = {
  id: string;
  full_name: string | null;
  created_at: string;
  updated_at: string;
};

export type Family = {
  id: string;
  name: string;
  currency: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type FamilyRole = "owner" | "member";
export type MembershipStatus = "active" | "inactive";

export type FamilyMember = {
  family_id: string;
  user_id: string;
  role: FamilyRole;
  status: MembershipStatus;
  joined_at: string;
};

export type FamilyInvitation = {
  id: string;
  family_id: string;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  used_by: string | null;
  revoked_at: string | null;
  created_at: string;
};

/** Tipe baris database Fase 2 (ledger minor-unit, ditulis manual). */

export type Account = {
  id: string;
  family_id: string;
  name: string;
  opening_balance_minor: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type CategoryKind = "income" | "expense";

export type Category = {
  id: string;
  family_id: string;
  name: string;
  kind: CategoryKind;
  created_by: string;
  created_at: string;
};

export type TransactionKind = "income" | "expense" | "transfer";
export type TransactionStatus = "posted" | "cancelled";

export type Transaction = {
  id: string;
  family_id: string;
  kind: TransactionKind;
  amount_minor: number;
  account_id: string | null;
  category_id: string | null;
  source_account_id: string | null;
  dest_account_id: string | null;
  note: string | null;
  occurred_at: string;
  status: TransactionStatus;
  cancelled_at: string | null;
  cancelled_by: string | null;
  idempotency_key: string;
  created_by: string;
  created_at: string;
};

export type AccountBalance = {
  account_id: string;
  account_name: string;
  opening_balance_minor: number;
  balance_minor: number;
};

export type MonthlySummary = {
  income_total_minor: number;
  expense_total_minor: number;
  net_minor: number;
};

/** Tipe baris database Fase 3 (anggaran bulanan, ditulis manual). */

export type Budget = {
  id: string;
  family_id: string;
  category_id: string;
  /** Hari pertama bulan, format YYYY-MM-01. */
  month: string;
  limit_minor: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type BudgetStatus = {
  budget_id: string;
  category_id: string;
  category_name: string;
  month: string;
  limit_minor: number;
  spent_minor: number;
  remaining_minor: number;
};

/** Tipe baris database Fase 5 (tujuan tabungan + kontribusi alokasi). */

export type GoalStatusKind = "active" | "completed" | "archived";
export type ContributionStatus = "posted" | "cancelled";

export type SavingsGoal = {
  id: string;
  family_id: string;
  name: string;
  description: string | null;
  target_minor: number;
  target_date: string | null;
  status: GoalStatusKind;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type GoalContribution = {
  id: string;
  family_id: string;
  goal_id: string;
  amount_minor: number;
  note: string | null;
  occurred_at: string;
  status: ContributionStatus;
  cancelled_at: string | null;
  cancelled_by: string | null;
  idempotency_key: string;
  created_by: string;
  created_at: string;
};

export type GoalStatusRow = {
  goal_id: string;
  goal_name: string;
  target_minor: number;
  allocated_minor: number;
  remaining_minor: number;
  status: string;
  target_date: string | null;
};
