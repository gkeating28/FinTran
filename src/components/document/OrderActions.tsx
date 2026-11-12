"use client";

import ConfirmSubmitButton from "@/components/ConfirmDialog";
import { createFromOrder } from "@/lib/document-actions";
import styles from "@/components/OpsPage.module.css";
import { DOCUMENT_FORM } from "./shared";
import { OrderStatusButton } from "./OrderStatusButton";
import type { DocumentFormState } from "./useDocumentForm";

/** Create from an order, and Activate, Close, Cancel and Reopen. */
export function OrderActionButtons({ form }: { form: DocumentFormState }) {
  const { header, typeCode, linksOpen, opened, closed, orderDocument, requisition, dirty, cannotSave, followOnNoun, followOnTypes, openPanel } = form;
  return (
    <>
      {header && opened && followOnTypes.length === 1 && dirty ? (
        <>
          <input type="hidden" form={DOCUMENT_FORM} name="target_type_id" value={followOnTypes[0].id} />
          <ConfirmSubmitButton
            className={styles.quiet}
            form={DOCUMENT_FORM}
            name="then_action"
            value="create_from_order"
            disabled={cannotSave}
            title={`Save and create ${requisition ? "a purchase order" : "an invoice"}?`}
            message={
              requisition
                ? "Your changes are saved first. The new purchase order starts with every line."
                : "Your changes are saved first. The new invoice starts with what is left on each line."
            }
            confirmLabel={`Save and create ${followOnNoun}`}
          >
            Save and create {followOnNoun}
          </ConfirmSubmitButton>
        </>
      ) : null}
      {header && opened && followOnTypes.length === 1 && !dirty ? (
        <form action={createFromOrder}>
          <input type="hidden" name="id" value={header.id} />
          <input type="hidden" name="target_type_id" value={followOnTypes[0].id} />
          {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
          <ConfirmSubmitButton
            className={styles.quiet}
            title={`Create ${requisition ? "a purchase order" : "an invoice"}?`}
            message={
              requisition
                ? "The new purchase order starts with every line."
                : "The new invoice starts with what is left on each line."
            }
            confirmLabel={`Create ${followOnNoun}`}
          >
            Create {followOnNoun}
          </ConfirmSubmitButton>
        </form>
      ) : null}
      {header && opened && followOnTypes.length > 1 ? (
        <button className={styles.quiet} type="button" aria-expanded={linksOpen} onClick={() => openPanel("links")}>
          {dirty ? "Save and create" : "Create"} {followOnNoun}
        </button>
      ) : null}
      {header && orderDocument && header.status === "draft" ? (
        <OrderStatusButton
          id={header.id}
          action="open"
          label={requisition ? "Activate requisition" : "Activate order"}
          typeCode={typeCode}
          className={styles.quiet}
          saveFirst={dirty}
          disabled={dirty && cannotSave}
          confirm={{
            title: requisition ? "Activate this requisition?" : "Activate this order?",
            message: requisition ? "An active requisition can be turned into a purchase order. It can still be changed." : "An active order can be invoiced. It can still be changed.",
          }}
        />
      ) : null}
      {header && opened ? (
        <>
          <OrderStatusButton
            id={header.id}
            action="close"
            label="Close order"
            typeCode={typeCode}
            className={styles.quiet}
            saveFirst={dirty}
            disabled={dirty && cannotSave}
            confirm={{ title: "Close this order?", message: "A closed order can be reopened." }}
          />
          <OrderStatusButton
            id={header.id}
            action="cancel"
            label="Cancel order"
            typeCode={typeCode}
            className={styles.quiet}
            saveFirst={dirty}
            disabled={dirty && cannotSave}
            confirm={{ title: "Cancel this order?", message: "A cancelled order cannot be reopened or changed." }}
          />
        </>
      ) : null}
      {header && closed ? (
        <OrderStatusButton id={header.id} action="reopen" label="Reopen order" typeCode={typeCode} className={styles.quiet} />
      ) : null}
    </>
  );
}
