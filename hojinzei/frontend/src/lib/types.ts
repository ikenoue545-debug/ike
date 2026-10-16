export type Severity = "critical" | "warning" | "info";

export type Target = { type: string; key?: string; id?: number | string; page?: string; section?: string };

export type Finding = {
  code: string;
  severity: Severity;
  severity_label: string;
  category: string;
  title: string;
  message: string;
  action: string;
  targets: Target[];
  fingerprint: string;
  acknowledged?: boolean;
  ack_note?: string | null;
};

export type Cell = {
  key: string;
  schedule: string;
  line: string;
  col: string;
  label: string;
  value: number | null;
  formula: string;
  refs: string[];
  basis: string[];
  source: "input" | "computed" | "override" | "rule";
  computed_value: number | null;
  override_reason: string;
  notes: string[];
  unit: "yen" | "text" | "months" | "rate";
  text: string | null;
};

export type ScheduleRow = { line: string; label: string; cells: Record<string, string>; kind: string; indent: number };

export type Schedule = {
  id: string;
  title: string;
  form_name: string;
  columns: { id: string; label: string }[];
  rows: ScheduleRow[];
  notes: string[];
  status: "computed" | "not_applicable" | "not_required";
  status_note: string;
};

export type RuleVersion = {
  rule_id: string;
  title: string;
  basis: string;
  basis_label: string;
  version: string;
  valid_from: string;
  valid_to: string | null;
  applies_to: string;
  conditions: string;
  values: Record<string, unknown>;
  sources: { title: string; url: string; provisions: string; checked: string }[];
  status: string;
  status_label: string;
  checked_by: string;
  checked_at: string;
  expert_review: string;
  notes: string[];
  reviews?: { reviewer_name: string; note: string | null; reviewed_at: string }[];
};

export type RequiredSchedule = {
  form: string;
  name: string;
  needed: boolean;
  implemented: boolean;
  reason: string;
  view: string | null;
};

export type DocItem = {
  kind: string;
  label: string;
  need: "required" | "recommended" | "not_needed";
  need_reason: string;
  status: "ok" | "missing" | "recommended" | "not_needed";
  uploaded: number;
  how: string;
};

export type EngineAdjustment = {
  id: string;
  name: string;
  line: string;
  direction: "add" | "deduct";
  disposition: string;
  amount: number | null;
  status: string;
  origin: "user" | "engine";
  note: string;
  basis: string[];
  confirmed: boolean;
};

export type Summary = {
  company_name: string;
  period_start: string;
  period_end: string;
  months: number;
  filing_deadline: string;
  sme: boolean | null;
  income: number | null;
  corporate_tax: number | null;
  corporate_final: number | null;
  local_corporate_final: number | null;
  defense_applicable: boolean;
  defense_final: number | null;
  national_final_total: number | null;
  corporate_refund: number | null;
  local_refund: number | null;
  loss_deduction: number | null;
  loss_carryforward: number | null;
  retained_earnings_close: number | null;
  recommended_tax_provision: number | null;
  recommended_tax_provision_note: string;
};

export type FiscalYear = {
  id: number;
  company_id: number;
  start_date: string;
  end_date: string;
  label: string;
  return_kind: string;
  blue_return: boolean;
  capital_end: number | null;
  large_corp_subsidiary: boolean | null;
  tekiyo_jogai: boolean | null;
  group_tsusan: boolean;
  dividends: number | null;
  unsupported_features: string[];
  status: string;
  status_label: string;
  reviewer_id: number | null;
  approved_by: number | null;
  approved_at: string | null;
  previous_id: number | null;
  filing_deadline: string;
  last_computed_at: string | null;
  critical_count: number | null;
  warning_count: number | null;
  updated_at: string;
};

export type User = { id: number; email: string; display_name: string; role: string; is_active: boolean };

export type Company = {
  id: number;
  name: string;
  name_kana: string | null;
  corporate_number: string | null;
  corp_kind: string;
  corp_category: string;
  head_office_address: string | null;
  prefecture: string | null;
  municipality: string | null;
  phone: string | null;
  representative: string | null;
  tax_office: string | null;
  local_tax_offices: string | null;
  industry: string | null;
  business_description: string | null;
  established_on: string | null;
  fiscal_year_end_month: number | null;
  filing_extension_months: number;
  assigned_user_id: number | null;
  assigned_user: User | null;
  notes: string | null;
  updated_at: string;
  member_ids?: number[];
};

export type CompanyListItem = Company & { current_year: FiscalYear | null; fiscal_year_count: number; last_updated: string };

export type CompanyDetail = Company & {
  fiscal_years: FiscalYear[];
  address_candidates: { prefecture: string | null; municipality: string | null };
  local_tax_candidates: { kind: string; office: string; note?: string }[];
  tax_office_note: string;
  tax_office_url: string;
};

export type FiscalYearDetail = FiscalYear & {
  company: Company;
  months: number;
  history: { from: string | null; to: string; note: string | null; by: User | null; at: string }[];
  reviewer: User | null;
  approver: User | null;
};

export type ReturnData = {
  engine_version: string;
  input_hash: string;
  months: number;
  sme: boolean | null;
  cells: Record<string, Cell>;
  schedules: Schedule[];
  findings: Finding[];
  rules_used: RuleVersion[];
  required: RequiredSchedule[];
  summary: Summary;
  adjustments: EngineAdjustment[];
  carryforward: Record<string, unknown>;
  documents: DocItem[];
  counts: { critical: number; warning: number; info: number; warning_open: number };
  tb_totals: Record<string, number | null>;
  provision_charged_hint: number | null;
  fiscal_year: FiscalYear;
  approved_snapshot: { id: number; input_hash: string; created_at: string; matches_current: boolean } | null;
};

export type Adjustment = {
  id: number;
  fiscal_year_id: number;
  kind: string;
  name: string;
  line: string;
  direction: "add" | "deduct";
  disposition: "ryuho" | "sonota" | "haitou" | "kome";
  amount: number | null;
  target_amount: number | null;
  status: "auto" | "review" | "missing" | "unsupported";
  decision: "pending" | "adopted" | "dismissed";
  confirmed: boolean;
  confirmed_by: number | null;
  confirmed_at: string | null;
  five1_key: string | null;
  five1_name: string | null;
  five1_column: "increase" | "decrease";
  account_names: string[];
  reason: string | null;
  basis: string[];
  evidence: { type: string; account_names?: string[]; months?: Record<string, number> }[];
  questions: string[];
  dismiss_reason: string | null;
  origin: "user" | "suggestion" | "carryover";
  suggestion_key: string | null;
  created_at: string;
  updated_at: string;
};

export type Meta = {
  statuses: { key: string; label: string }[];
  roles: Record<string, string>;
  categories: { key: string; section: string; section_label: string; label: string }[];
  b4_lines: { line: string; label: string; direction: string; dispositions: string[] }[];
  dispositions: Record<string, string>;
  adjustment_statuses: Record<string, string>;
  doc_kinds: Record<string, string>;
  unsupported_features: { key: string; label: string; note: string }[];
  tax_flags: Record<string, string>;
  adjustment_templates: {
    kind: string;
    name: string;
    line: string;
    direction: "add" | "deduct";
    disposition: "ryuho" | "sonota" | "haitou" | "kome";
    five1_key?: string;
    five1_name?: string;
    five1_column?: "increase" | "decrease";
    basis: string[];
  }[];
};
