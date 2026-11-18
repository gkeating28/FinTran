/** The roles a rule can ask for, lowest first. A member cannot approve. */
export const APPROVER_ROLES = ["admin", "owner"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

/** Who must approve, as it reads in a message: "an admin or owner", because an owner can approve anything an admin can. */
export function approverPhrase(role: string | null | undefined) {
  return role === "owner" ? "an owner" : "an admin or owner";
}

export function approverLabel(role: string) {
  return role === "owner" ? "Owner" : "Admin or owner";
}

export type ApprovalRuleRow = {
  id: string;
  typeId: string;
  typeCode: string;
  typeDescription: string;
  /** Purchase invoice or purchase order. */
  kind: "invoice" | "order";
  /** Plain number with two decimals, in the home currency. */
  amount: string;
  role: ApproverRole;
  active: boolean;
};

export type ApprovalTypeChoice = {
  id: string;
  code: string;
  description: string;
  kind: "invoice" | "order";
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An amount as typed, with or without thousands separators, up to two decimals and above zero. */
export function parseRuleAmount(value: string): string | null {
  const plain = value.trim().replace(/,/g, "");
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(plain)) return null;
  const amount = Number(plain);
  if (!(amount > 0)) return null;
  return amount.toFixed(2);
}

export type ApprovalRuleFields = {
  transaction_type_id: string;
  amount: string;
  required_role: ApproverRole;
  active: boolean;
};

export function parseApprovalRuleForm(input: {
  typeId: string;
  amount: string;
  role: string;
  active: boolean;
}): { fields: ApprovalRuleFields } | { error: string } {
  if (!UUID.test(input.typeId.trim())) return { error: "Choose a transaction type." };
  const amount = parseRuleAmount(input.amount);
  if (!amount) return { error: "Enter an amount above zero, with up to 2 decimal places." };
  const role = APPROVER_ROLES.find((item) => item === input.role);
  if (!role) return { error: "Choose who must approve." };
  return { fields: { transaction_type_id: input.typeId.trim(), amount, required_role: role, active: input.active } };
}

/** An approval email the mail adapter could not send. Owners and admins see these. */
export type FailedEmail = {
  id: string;
  recipient: string;
  subject: string;
  error: string;
  createdAt: string;
};
