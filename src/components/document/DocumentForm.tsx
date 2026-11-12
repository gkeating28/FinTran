"use client";

import { keepEntries } from "@/components/keepEntries";
import FormModal from "@/components/FormModal";
import styles from "@/components/OpsPage.module.css";
import documentStyles from "@/components/Document.module.css";
import { DOCUMENT_FORM, SPLIT_MIN } from "./shared";
import { ReadinessControl } from "./Readiness";
import { LineEditor } from "./LineEditor";
import { useDocumentForm, type DocumentFormProps } from "./useDocumentForm";
import { HeaderPane } from "./HeaderPane";
import { LinesPane } from "./LinesPane";
import { CreditNotesDialog, InvoiceActionButtons, SaveButtons, VoidDialog } from "./InvoiceActions";
import { OrderActionButtons } from "./OrderActions";
import { BringInOrders, LinkedDocumentsPanel } from "./LinkedDocuments";

/** The open document: a modal with the header and lines side by side, the dialogs, and the buttons along the bottom. */
export default function DocumentForm(props: DocumentFormProps) {
  const form = useDocumentForm(props);
  const { title, header, readiness, readinessPending, choices, typeCode, direction, canDownload, onClose, setFieldsDirty, invoiceLines, lineDraft, setLineDraft, lineMessage, setLineMessage, sales, locked, action, lineVat, glChoices, orderDocument, banner, saveLine, splitRef, headerWidth, sideBySide, splitStyle, splitMax, dragSplit, nudgeSplit } = form;
  return (
    <>
    <FormModal
      title={locked ? `View ${title}` : header ? `Edit ${title}` : `Add ${title}`}
      onClose={onClose}
      fillPage
    >
      <div className={styles.modalForm}>
      <form
        id={DOCUMENT_FORM}
        className={styles.documentFields}
        onSubmit={keepEntries(action)}
        onInput={() => setFieldsDirty(true)}
        onChange={() => setFieldsDirty(true)}
        autoComplete="off"
        noValidate
      >
        {typeCode ? <input type="hidden" name="return_to" value={`/transactions/${typeCode}`} /> : null}
        {header ? <input type="hidden" name="id" value={header.id} /> : null}
        {locked ? null : <input type="hidden" name="lines" value={JSON.stringify(invoiceLines)} />}
        <div className={styles.statusRow}>
          {banner ? (
            <p className={banner.tone === "alert" ? styles.alert : styles.notice} role={banner.tone === "alert" ? "alert" : "status"} title={banner.text}>
              {banner.text}
            </p>
          ) : (
            <span />
          )}
          {header && !orderDocument ? (
            <div className={styles.readinessBar}>
              <ReadinessControl items={readiness} direction={direction} pending={readinessPending} />
              {canDownload ? (
                <a className={styles.quiet} href={`/transactions/${header.transactionTypeCode}/${header.id}/en16931`}>
                  Download EN 16931 JSON
                </a>
              ) : null}
            </div>
          ) : null}
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
          aria-valuenow={headerWidth ?? Math.round(splitMax / 2)}
          tabIndex={sideBySide ? 0 : -1}
          onPointerDown={dragSplit}
          onKeyDown={nudgeSplit}
        />
        <LinesPane form={form} />
        </div>
      </form>
      <VoidDialog form={form} />
      <BringInOrders form={form} />
      <LinkedDocumentsPanel form={form} />
      <CreditNotesDialog form={form} />
      <div className={styles.modalActions}>
        <div className={documentStyles.actionCluster}>
          <InvoiceActionButtons form={form} />
          <OrderActionButtons form={form} />
        </div>
        <div className={documentStyles.actionCluster}>
          <SaveButtons form={form} />
        </div>
      </div>
      </div>
    </FormModal>
    {lineDraft ? (
      <LineEditor
        draft={lineDraft}
        products={choices.products}
        units={choices.units}
        glCodes={glChoices}
        departments={choices.departments}
        costCentres={choices.costCentres}
        vatRates={lineVat}
        sales={sales}
        readOnly={locked}
        message={lineMessage}
        onChange={setLineDraft}
        onSave={saveLine}
        onCancel={() => {
          setLineDraft(null);
          setLineMessage(null);
        }}
      />
    ) : null}
    </>
  );
}
