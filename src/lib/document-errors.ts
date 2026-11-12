/** Turns a database error from saving or posting a document into a sentence a person can act on. */
export function friendlyError(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === "23505" && error.message.includes("supplier_reference")) {
    return "This supplier invoice number has already been entered for this supplier.";
  }
  if (error.code === "23505") return "That reference is already used for this transaction type.";
  if (error.code === "23503" && error.message.includes("suppliers")) {
    return "Choose a supplier from this organisation.";
  }
  if (error.code === "23503" && error.message.includes("currencies")) {
    return "Choose a currency from this organisation.";
  }
  if (error.code === "23503" && error.message.includes("unit_code")) return "Choose a unit.";
  if (error.code === "23503" && error.message.includes("preceding_header")) {
    return "Choose a posted invoice from this organisation.";
  }
  if (error.code === "23503" && error.message.includes("source_line")) {
    return "A line that another document was created from cannot be removed.";
  }
  if (error.code === "23503") return "Choose a code from this organisation.";
  if (error.code === "P0001") return error.message;
  if (error.message.includes("Discount cannot")) return "Discount cannot be more than quantity times price.";
  if (error.message.includes("Purchases transaction type")) return "Choose a Purchases transaction type.";
  if (error.message.includes("exchange rate")) return "Enter an exchange rate greater than 0.";
  if (error.message.includes("Expense rate")) return "Choose an Expense VAT rate.";
  return error.message || fallback;
}
