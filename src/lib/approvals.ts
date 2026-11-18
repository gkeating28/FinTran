import { approverPhrase } from "@/lib/approval-rules";

/** Where a draft purchase invoice or order stands on approval, as the screens need it. Only documents that need approval have one. */
export type ApprovalState = "required" | "requested" | "approved" | "rejected";

export type ApprovalInfo = {
  state: ApprovalState;
  /** The role the rule asks for. */
  role: "admin" | "owner";
  /** amount, price, or amount and price. */
  reason: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string;
  decidedAt: string;
  note: string;
  /** Approved by the person who asked, because nobody else could. */
  self: boolean;
  /** Whether the person looking could approve or refuse it now. */
  canDecide: boolean;
  /** Some line is priced over the tolerance. */
  priceOver: boolean;
};

export type PriceCheck = {
  lineId: string;
  lineNumber: number;
  orderPrice: string;
  invoicePrice: string;
  differencePercent: string;
  over: boolean;
};

/** One row of `approval_status`, as the database returns it. */
export type ApprovalRow = {
  header_id: string;
  state: string;
  required_role: string | null;
  reason: string | null;
  requested_by_name: string | null;
  requested_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  note: string | null;
  self: boolean | null;
  can_decide: boolean | null;
  price_over: boolean | null;
};

/** The screens' view of a row, or null for a state this code does not know. */
export function approvalFromRow(row: ApprovalRow): ApprovalInfo | null {
  const state = (["required", "requested", "approved", "rejected"] as const).find((item) => item === row.state);
  if (!state) return null;
  return {
    state,
    role: row.required_role === "owner" ? "owner" : "admin",
    reason: row.reason ?? "amount",
    requestedByName: row.requested_by_name ?? "",
    requestedAt: row.requested_at ?? "",
    decidedByName: row.decided_by_name ?? "",
    decidedAt: row.decided_at ?? "",
    note: row.note ?? "",
    self: Boolean(row.self),
    canDecide: Boolean(row.can_decide),
    priceOver: Boolean(row.price_over),
  };
}

/** Whether the document still has to be approved before it can be posted or activated. */
export function needsApproval(info: ApprovalInfo | null | undefined) {
  return Boolean(info) && info?.state !== "approved";
}

function reasonText(reason: string) {
  if (reason === "price") return "a price over the order";
  if (reason === "amount and price") return "its amount and a price over the order";
  return "its amount";
}

/** The one line for the status row. Null when there is nothing to say. */
export function approvalBanner(info: ApprovalInfo | null | undefined): { tone: "alert" | "notice"; text: string } | null {
  if (!info) return null;
  const who = approverPhrase(info.role);
  if (info.state === "required") {
    return { tone: "alert", text: `Needs approval from ${who} because of ${reasonText(info.reason)}. Request approval before it can be posted.` };
  }
  if (info.state === "requested") {
    return {
      tone: "notice",
      text: info.canDecide
        ? `${info.requestedByName || "Someone"} asked for approval because of ${reasonText(info.reason)}. Approve or refuse it.`
        : `Waiting for approval from ${who}, asked for by ${info.requestedByName || "someone"}.`,
    };
  }
  if (info.state === "rejected") {
    return { tone: "alert", text: `Approval was refused${info.decidedByName ? ` by ${info.decidedByName}` : ""}: ${info.note || "no reason was given"}. Change the document and ask again.` };
  }
  return { tone: "notice", text: `Approved${info.decidedByName ? ` by ${info.decidedByName}` : ""}${info.self ? ", as nobody else could" : ""}. It can be posted.` };
}

/** The label for a list column. */
export function approvalLabel(info: ApprovalInfo | null | undefined) {
  if (!info) return "";
  if (info.state === "required") return "Needs approval";
  if (info.state === "requested") return "Waiting";
  if (info.state === "rejected") return "Refused";
  return "Approved";
}

export const APPROVAL_FILTERS = [
  { value: "needs", label: "Needs approval" },
  { value: "waiting", label: "Waiting" },
  { value: "approved", label: "Approved" },
  { value: "refused", label: "Refused" },
] as const;

/** Whether a document's approval matches the list filter. */
export function approvalMatches(info: ApprovalInfo | null | undefined, filter: string) {
  if (!filter) return true;
  if (!info) return false;
  if (filter === "needs") return info.state === "required";
  if (filter === "waiting") return info.state === "requested";
  if (filter === "approved") return info.state === "approved";
  if (filter === "refused") return info.state === "rejected";
  return true;
}
