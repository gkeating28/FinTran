"use client";

import { BringInDialog, LinkedDocumentsDialog } from "@/components/OrderDialogs";
import { createFromOrder } from "@/lib/document-actions";
import { documentStatusLabel } from "@/lib/transaction-types";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { DOCUMENT_FORM } from "./shared";
import type { DocumentFormState } from "./useDocumentForm";

/** Brings lines in from the active orders of the party on an invoice. */
export function BringInOrders({ form }: { form: DocumentFormState }) {
  const { supplierId, invoiceLines, ordersOpen, setOrdersOpen, sales, region, canBringIn, partyOrders, bringIn } = form;
  return (
    ordersOpen && canBringIn ? (
      <BringInDialog
        orders={partyOrders}
        takenLineIds={new Set(invoiceLines.flatMap((line) => (line.sourceLineId ? [line.sourceLineId] : [])))}
        partyNoun={sales ? "customer" : "supplier"}
        hasParty={Boolean(supplierId)}
        region={region}
        onBringIn={bringIn}
        onClose={() => setOrdersOpen(false)}
      />
    ) : null
  );
}

/** The documents this one came from, and the ones created from it. */
export function LinkedDocumentsPanel({ form }: { form: DocumentFormState }) {
  const { header, typeCode, linksOpen, setLinksOpen, sales, region, opened, orderDocument, requisition, dirty, cannotSave, followOnNoun, followOnTypes, showLinks } = form;
  return (
    linksOpen && showLinks && header ? (
      <LinkedDocumentsDialog
        sources={header.sources}
        followOns={orderDocument ? header.followOns : null}
        followOnLabel={`${requisition ? "Purchase orders" : "Invoices"} created from this`}
        region={region}
        note={
          !orderDocument
            ? undefined
            : header.status === "draft"
              ? `Activate it to create ${requisition ? "a purchase order" : "an invoice"} from it.`
              : !opened
                ? `It is ${documentStatusLabel(header.status).toLowerCase()}, so nothing more can be created from it.`
                : followOnTypes.length === 0
                  ? `Add a ${sales ? "Sales" : "Purchases"} ${followOnNoun} type under Transaction types before creating one.`
                  : requisition
                    ? "A new purchase order starts with every line."
                    : "A new invoice starts with what is left on each line."
        }
        create={
          orderDocument && opened && followOnTypes.length > 0 ? (
            <form action={dirty ? undefined : createFromOrder} onSubmit={dirty ? (event) => event.preventDefault() : undefined} className={documentStyles.dialogCreate}>
              <input type="hidden" name="id" value={header.id} />
              {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
              {followOnTypes.length > 1 ? (
                <label className={styles.field}>
                  Type
                  <select name="target_type_id" form={dirty ? DOCUMENT_FORM : undefined} required defaultValue="">
                    <option value="">Choose a type</option>
                    {followOnTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.code} — {type.description}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <input type="hidden" name="target_type_id" form={dirty ? DOCUMENT_FORM : undefined} value={followOnTypes[0]?.id ?? ""} />
              )}
              <div className={styles.modalActions}>
                <button className={styles.quiet} type="button" onClick={() => setLinksOpen(false)}>
                  Close
                </button>
                {dirty ? (
                  <button className={styles.primary} type="submit" form={DOCUMENT_FORM} name="then_action" value="create_from_order" disabled={cannotSave}>
                    Save and create {followOnNoun}
                  </button>
                ) : (
                  <button className={styles.primary} type="submit">
                    Create {followOnNoun}
                  </button>
                )}
              </div>
            </form>
          ) : undefined
        }
        onClose={() => setLinksOpen(false)}
      />
    ) : null
  );
}
