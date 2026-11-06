export function shouldGenerateEInvoice(type: string | undefined, kind: string | undefined) {
  return type === "Sales" && (kind === "invoice" || kind === "credit_note");
}

export function postedEInvoiceError(error: unknown) {
  const message = error instanceof Error ? error.message : "The e-invoice could not be generated.";
  return `Posted, but the e-invoice was not stored. ${message}`;
}
