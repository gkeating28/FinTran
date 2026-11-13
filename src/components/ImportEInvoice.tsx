"use client";

import FormModal from "@/components/FormModal";
import { RejectEInvoice } from "@/components/RejectEInvoice";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { SPLIT_MIN } from "@/components/import-einvoice/splitWidth";
import { useImportForm, type ImportFormProps } from "@/components/import-einvoice/useImportForm";
import { LineCoding } from "@/components/import-einvoice/LineCoding";
import { HeaderPane } from "@/components/import-einvoice/HeaderPane";
import { LinesPane } from "@/components/import-einvoice/LinesPane";
import { CreateSupplierDialog } from "@/components/import-einvoice/CreateSupplierDialog";

/** The screen that turns a received e-invoice into a draft purchase document. */
export function ImportEInvoice(props: ImportFormProps) {
  const form = useImportForm(props);
  const { id, creditNote, canReject, rates, glCodes, departments, costCentres, units, purchaseTypes, typesReady, typeId, saving, openLine, setOpenLine, lineMessage, blocked, title, statusText, close, saveLine, submit, sideBySide, splitRef, storedWidth, splitMax, splitStyle, dragSplit, nudgeSplit } = form;
  return (
    <>
      <FormModal title={title} onClose={close} fillPage>
        <div className={styles.modalForm}>
          <form id="import-document" className={styles.documentFields} autoComplete="off" onSubmit={submit}>
            <div className={styles.statusRow}>
              <p
                className={statusText ? styles.alert : styles.notice}
                role={statusText ? "alert" : "status"}
                title={statusText ?? "Received and valid. The document is read-only, except the supplier and the line codes."}
              >
                {typesReady && purchaseTypes.length === 0 && !typeId ? (
                  <>
                    Add a Purchases {creditNote ? "credit note" : "invoice"} under <a href="/transaction-types">Transaction types</a> before importing.
                  </>
                ) : (
                  statusText ?? "Received and valid. The document is read-only, except the supplier and the line codes."
                )}
              </p>
              <div className={styles.readinessBar}>
                <a className={styles.quiet} href={`/api/einvoice/${id}/xml`}>
                  Download XML
                </a>
              </div>
            </div>
            <div className={`${styles.invoiceSplit} ${sideBySide ? "" : styles.invoiceStacked}`} ref={splitRef} style={splitStyle}>
              <HeaderPane form={form} />
              <button
                className={styles.splitHandle}
                type="button"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize header and lines"
                aria-valuemin={SPLIT_MIN}
                aria-valuemax={splitMax}
                aria-valuenow={storedWidth ?? Math.round(splitMax / 2)}
                tabIndex={sideBySide ? 0 : -1}
                onPointerDown={dragSplit}
                onKeyDown={nudgeSplit}
              />
              <LinesPane form={form} />
            </div>
          </form>
          <div className={styles.modalActions}>
            <div className={documentStyles.actionCluster}>
              {canReject ? <RejectEInvoice id={id} className={styles.quiet} /> : null}
            </div>
            <div className={documentStyles.actionCluster}>
              <button className={styles.quiet} type="button" onClick={close}>
                Cancel
              </button>
              <button className={styles.primary} type="submit" form="import-document" disabled={blocked}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </FormModal>
      {openLine ? (
        <LineCoding
          line={openLine}
          message={lineMessage}
          rates={rates}
          glCodes={glCodes}
          departments={departments}
          costCentres={costCentres}
          units={units}
          onChange={setOpenLine}
          onCancel={() => setOpenLine(null)}
          onSave={saveLine}
        />
      ) : null}
      <CreateSupplierDialog form={form} />
    </>
  );
}
