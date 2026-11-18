"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import ConfirmSubmitButton from "@/components/ConfirmDialog";
import DataGrid from "@/components/DataGrid";
import FormModal from "@/components/FormModal";
import { QuietInput } from "@/components/QuietField";
import { keepEntries } from "@/components/keepEntries";
import styles from "@/components/OpsPage.module.css";
import recordStyles from "@/components/RecordForm.module.css";
import { createApprovalRule, deleteApprovalRule, updateApprovalRule } from "@/lib/approval-rule-actions";
import { APPROVER_ROLES, approverLabel, type ApprovalRuleRow, type ApprovalTypeChoice } from "@/lib/approval-rules";
import { formatMoney } from "@/lib/documents";
import type { ActionState } from "@/lib/types";

export default function ApprovalRuleManager({
  rows,
  types,
  loadError,
  actionError,
  canEdit = true,
  organisationName,
}: {
  rows: ApprovalRuleRow[];
  types: ApprovalTypeChoice[];
  loadError: string | null;
  actionError?: string;
  canEdit?: boolean;
  organisationName: string;
}) {
  const [draft, setDraft] = useState<ApprovalRuleRow | "new" | null>(null);

  return (
    <section className={styles.stack}>
      <div>
        <h1 className={styles.heading}>Approval rules</h1>
        <p className={styles.lede}>
          Approval rules for {organisationName}. From each amount, a purchase invoice or purchase order of that type needs approval from the
          role shown before it can be posted or activated. With no rule, nothing needs approval. The price tolerance is on the{" "}
          <Link href="/organisations">Organisations</Link> screen.
        </p>
      </div>
      {loadError ? (
        <p className={styles.alert} role="alert">
          {loadError}
        </p>
      ) : null}
      {actionError ? (
        <p className={styles.alert} role="alert">
          {actionError}
        </p>
      ) : null}
      <DataGrid
        form="approval-rules"
        onOpen={(row) => setDraft(row)}
        rows={rows}
        searchPlaceholder="Search approval rules"
        searchText={(row) => `${row.typeCode} ${row.typeDescription} ${row.amount} ${approverLabel(row.role)} ${row.active ? "" : "inactive"}`}
        emptyLabel="No approval rules yet for this organisation, so nothing needs approval."
        toolbar={
          canEdit && types.length > 0 ? (
            <button className={styles.primary} type="button" onClick={() => setDraft("new")}>
              Add
            </button>
          ) : null
        }
        columns={[
          { key: "type", label: "Type", mono: true, sortValue: (row) => row.typeCode, render: (row) => row.typeCode },
          { key: "description", label: "Description", sortValue: (row) => row.typeDescription, render: (row) => row.typeDescription },
          {
            key: "amount",
            label: "From amount",
            mono: true,
            align: "right",
            sortValue: (row) => row.amount,
            render: (row) => formatMoney(row.amount),
          },
          { key: "role", label: "Approved by", sortValue: (row) => row.role, render: (row) => approverLabel(row.role) },
          {
            key: "active",
            label: "Status",
            sortValue: (row) => (row.active ? "Active" : "Inactive"),
            render: (row) => (row.active ? "Active" : "Inactive"),
          },
        ]}
        actions={
          canEdit
            ? (row) => (
                <>
                  <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
                    Edit
                  </button>
                  <form action={deleteApprovalRule}>
                    <input type="hidden" name="id" value={row.id} />
                    <ConfirmSubmitButton
                      className={styles.quiet}
                      title={`Remove the ${row.typeCode} rule from ${formatMoney(row.amount)}?`}
                      message="Documents of that type will no longer need approval at that amount. Approvals already given are kept."
                    >
                      Remove
                    </ConfirmSubmitButton>
                  </form>
                </>
              )
            : (row) => (
                <button className={styles.quiet} type="button" onClick={() => setDraft(row)}>
                  View
                </button>
              )
        }
      />
      {draft ? (
        <ApprovalRuleForm
          key={draft === "new" ? "new" : draft.id}
          row={draft === "new" ? null : draft}
          types={types}
          readOnly={!canEdit}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </section>
  );
}

function ApprovalRuleForm({
  row,
  types,
  readOnly = false,
  onClose,
}: {
  row: ApprovalRuleRow | null;
  types: ApprovalTypeChoice[];
  readOnly?: boolean;
  onClose: () => void;
}) {
  const save = row ? updateApprovalRule : createApprovalRule;
  const [state, action, pending] = useActionState(save, {} as ActionState);
  const [typeId, setTypeId] = useState(row?.typeId ?? types[0]?.id ?? "");
  const [amount, setAmount] = useState(row ? formatMoney(row.amount) : "");
  const [role, setRole] = useState<string>(row?.role ?? "admin");
  const [active, setActive] = useState(row?.active ?? true);

  useEffect(() => {
    if (state.message) onClose();
  }, [state.message, onClose]);

  return (
    <FormModal
      title={readOnly ? "View approval rule" : row ? "Edit approval rule" : "Add approval rule"}
      onClose={onClose}
      className={recordStyles.dialogMedium}
    >
      <form
        className={`${styles.modalForm}${readOnly ? ` ${styles.formReadOnly}` : ""}`}
        onSubmit={keepEntries(action)}
        autoComplete="off"
        noValidate
      >
        {row ? <input type="hidden" name="id" value={row.id} /> : null}
        {row ? <input type="hidden" name="transaction_type_id" value={row.typeId} /> : null}
        {state.error ? (
          <p className={styles.alert} role="alert">
            {state.error}
          </p>
        ) : null}
        <div className={recordStyles.cols}>
          <label className={recordStyles.cell}>
            Transaction type
            <select
              name={row ? undefined : "transaction_type_id"}
              required
              disabled={Boolean(row)}
              value={typeId}
              onChange={(event) => setTypeId(event.target.value)}
            >
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.code} {type.description}
                </option>
              ))}
            </select>
          </label>
          <label className={recordStyles.cell}>
            From amount, with VAT, in the home currency
            <QuietInput
              name="amount"
              required
              inputMode="decimal"
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className={recordStyles.cell}>
            Approved by
            <select name="required_role" required value={role} onChange={(event) => setRole(event.target.value)}>
              {APPROVER_ROLES.map((item) => (
                <option key={item} value={item}>
                  {approverLabel(item)}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.checkLine}>
            <input type="checkbox" name="active" checked={active} onChange={(event) => setActive(event.target.checked)} />
            Active
          </label>
        </div>
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onClose}>
            {readOnly ? "Close" : "Cancel"}
          </button>
          {readOnly ? null : (
            <button className={styles.primary} type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </button>
          )}
        </div>
      </form>
    </FormModal>
  );
}
