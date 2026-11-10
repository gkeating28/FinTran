import { readinessHref } from "@/lib/en16931";

/**
 * Plain English for the e-invoice rules a person is most likely to hit. The rule text from the validator is
 * written for software, so each entry says what is wrong, what to change and where to change it. Ask Qula
 * reads these instead of guessing at fixes.
 */
export type RuleHelp = {
  title: string;
  why: string;
  fix: string;
  /** Where the fix is made. "party" means the supplier, customer or organisation the business term belongs to. */
  place: "party" | "header" | "lines" | "totals" | "vat" | "sender";
};

export type IssueHelp = {
  title: string;
  why: string;
  fix: string;
  where: string;
  href: string | null;
};

const SENDER = "The e-invoice was made with a standard identifier that is missing or wrong. Regenerate it. If it was received from a supplier, ask them to send a corrected file.";

const RULES: Record<string, RuleHelp> = {
  "BR-01": { title: "No specification identifier", why: "The invoice does not say which e-invoicing standard it follows.", fix: SENDER, place: "sender" },
  "BR-02": { title: "No invoice number", why: "Every e-invoice needs an invoice number.", fix: "Enter the invoice number on the document.", place: "header" },
  "BR-03": { title: "No issue date", why: "Every e-invoice needs an issue date.", fix: "Enter the document date.", place: "header" },
  "BR-04": { title: "No invoice type", why: "The invoice must say whether it is an invoice or a credit note.", fix: "Check the transaction type is an invoice or a credit note, then regenerate.", place: "header" },
  "BR-05": { title: "No currency", why: "Every e-invoice needs a document currency.", fix: "Check the supplier or customer has a currency, then regenerate.", place: "header" },
  "BR-06": { title: "Seller name missing", why: "The seller must be named on the invoice.", fix: "Enter the name.", place: "party" },
  "BR-07": { title: "Buyer name missing", why: "The buyer must be named on the invoice.", fix: "Enter the name.", place: "party" },
  "BR-08": { title: "Seller address incomplete", why: "The seller postal address needs a street, a city and a country.", fix: "Complete the address.", place: "party" },
  "BR-09": { title: "Seller country missing", why: "The seller postal address needs a country code.", fix: "Choose the country.", place: "party" },
  "BR-10": { title: "Buyer address incomplete", why: "The buyer postal address needs a street, a city and a country.", fix: "Complete the address.", place: "party" },
  "BR-11": { title: "Buyer country missing", why: "The buyer postal address needs a country code.", fix: "Choose the country.", place: "party" },
  "BR-12": { title: "Sum of line amounts missing", why: "The invoice total of its line amounts is not stated.", fix: "Check every line has a quantity and price, then regenerate.", place: "totals" },
  "BR-13": { title: "Total without VAT missing", why: "The invoice total before VAT is not stated.", fix: "Check every line has a quantity and price, then regenerate.", place: "totals" },
  "BR-14": { title: "Total with VAT missing", why: "The invoice total including VAT is not stated.", fix: "Check every line has a quantity, a price and a VAT code, then regenerate.", place: "totals" },
  "BR-15": { title: "Amount due missing", why: "The amount to pay is not stated.", fix: "Check the totals on the document, then regenerate.", place: "totals" },
  "BR-16": { title: "No lines", why: "An invoice needs at least one line.", fix: "Add a line to the document.", place: "lines" },
  "BR-21": { title: "A line has no line number", why: "Each line needs an identifier.", fix: SENDER, place: "sender" },
  "BR-22": { title: "A line has no quantity", why: "Each line needs a quantity.", fix: "Enter the quantity on the line.", place: "lines" },
  "BR-23": { title: "A line has no unit", why: "Each line needs a unit of measure.", fix: "Choose a unit on the line, or on the product.", place: "lines" },
  "BR-24": { title: "A line has no amount", why: "Each line needs a net amount.", fix: "Enter the quantity and price on the line.", place: "lines" },
  "BR-25": { title: "A line has no item name", why: "Each line needs a description of the item.", fix: "Enter a description on the line.", place: "lines" },
  "BR-26": { title: "A line has no price", why: "Each line needs a net price.", fix: "Enter the price on the line.", place: "lines" },
  "BR-CO-04": { title: "A line has no VAT code", why: "Each line must say which VAT category applies.", fix: "Choose a VAT code on the line.", place: "lines" },
  "BR-CO-09": { title: "VAT number needs a country prefix", why: "A VAT identifier must start with a two letter country code, such as IE, or EL for Greece.", fix: "Add the country prefix to the VAT number, for example IE1234567T.", place: "party" },
  "BR-CO-10": { title: "Line amounts do not add up", why: "The sum of the lines is not the same as the invoice's line total.", fix: "Check the lines and regenerate. On a received invoice the file itself is wrong, so ask the sender for a correction.", place: "totals" },
  "BR-CO-13": { title: "Total without VAT does not add up", why: "The total before VAT is not the lines less allowances plus charges.", fix: "Check the lines, discounts and rounding, then regenerate. On a received invoice ask the sender for a correction.", place: "totals" },
  "BR-CO-14": { title: "Total VAT does not add up", why: "The invoice VAT is not the sum of the VAT in each VAT category.", fix: "Check the VAT codes on the lines, then regenerate. On a received invoice ask the sender for a correction.", place: "totals" },
  "BR-CO-15": { title: "Total with VAT does not add up", why: "The total with VAT is not the total without VAT plus the VAT.", fix: "Check the totals, then regenerate. On a received invoice ask the sender for a correction.", place: "totals" },
  "BR-CO-16": { title: "Amount due does not add up", why: "The amount due is not the total with VAT less anything already paid, plus rounding.", fix: "Check payments and rounding on the document, then regenerate. On a received invoice ask the sender for a correction.", place: "totals" },
  "BR-CO-17": { title: "VAT amount does not match the rate", why: "The VAT for a category is not the taxable amount times the rate, rounded to two decimals.", fix: "Check the VAT rate on the lines, then regenerate. On a received invoice ask the sender for a correction.", place: "totals" },
  "BR-CO-25": { title: "No due date or payment terms", why: "When an amount is due, the invoice needs a due date or payment terms.", fix: "Enter a due date, or add payment terms on the supplier or customer.", place: "header" },
  "BR-S-01": { title: "No VAT breakdown for the standard rate", why: "A standard rated line needs a matching VAT breakdown.", fix: "Check the VAT code on the lines, then regenerate.", place: "totals" },
  "BR-S-02": { title: "Seller VAT number missing", why: "A standard rated line needs the seller's VAT identifier.", fix: "Enter the seller's VAT number.", place: "party" },
  "BR-S-05": { title: "Standard rate is zero", why: "A line marked standard rated must have a rate above zero.", fix: "Use a zero rated or exempt VAT code for that line, or correct the rate.", place: "vat" },
  "BR-S-08": { title: "VAT breakdown does not match the lines", why: "The taxable amount for the standard rate is not the sum of its lines.", fix: "Check the VAT codes on the lines, then regenerate.", place: "totals" },
  "BR-S-09": { title: "VAT breakdown amount is wrong", why: "The VAT amount for the standard rate is not the taxable amount times the rate.", fix: "Check the rate and rounding, then regenerate.", place: "totals" },
  "BR-IC-02": { title: "Buyer VAT number missing", why: "An intra-Community line needs both the seller's and the buyer's VAT identifiers.", fix: "Enter the buyer's VAT number.", place: "party" },
  "BR-AE-02": { title: "VAT identifiers missing for reverse charge", why: "A reverse charge line needs the seller's and the buyer's VAT identifiers.", fix: "Enter the VAT number, or the company number for the buyer.", place: "party" },
  "PEPPOL-EN16931-R001": { title: "No business process", why: "A Peppol invoice must say which business process it belongs to.", fix: SENDER, place: "sender" },
  "PEPPOL-EN16931-R002": { title: "More than one invoice note", why: "A Peppol invoice allows only one note at invoice level.", fix: "Keep one note on the document, then regenerate.", place: "header" },
  "PEPPOL-EN16931-R003": { title: "No buyer reference or order number", why: "A Peppol invoice needs a buyer reference or a purchase order reference so the buyer can route it.", fix: "Enter a buyer reference or an order number on the document. A customer can have a default buyer reference.", place: "header" },
  "PEPPOL-EN16931-R004": { title: "Wrong specification version", why: "The invoice names a Peppol version this system does not accept.", fix: SENDER, place: "sender" },
  "PEPPOL-EN16931-R008": { title: "Empty elements", why: "A Peppol invoice must not contain empty fields.", fix: "Regenerate the e-invoice. On a received invoice ask the sender for a corrected file.", place: "sender" },
  "PEPPOL-EN16931-R010": { title: "Buyer Peppol address missing", why: "The buyer's electronic address (Peppol ID) is needed to deliver the invoice.", fix: "Enter the Peppol scheme and Peppol ID.", place: "party" },
  "PEPPOL-EN16931-R020": { title: "Seller Peppol address missing", why: "The seller's electronic address (Peppol ID) is needed to send the invoice.", fix: "Enter the Peppol scheme and Peppol ID.", place: "party" },
  "FINTRAN-BT-1": { title: "No supplier invoice number", why: "A purchase without the supplier's invoice number leaves the invoice number out of the e-invoice export.", fix: "Enter the supplier's invoice number as the supplier reference.", place: "header" },
  "BT-1": { title: "No document number", why: "The sales invoice has no document number.", fix: "Check the transaction type has a number prefix and padding, then save the document again.", place: "header" },
};

function prefixed(ruleId: string): RuleHelp | null {
  if (/^BR-CL-/.test(ruleId)) {
    return { title: "A code is not on the allowed list", why: "A unit, currency, country, VAT category or other code in the invoice is not one of the codes the standard allows.", fix: "Check the codes you entered: the unit on the product or line, the currency, the country and the VAT code. Use one from the list.", place: "header" };
  }
  if (/^BR-E-/.test(ruleId)) {
    return { title: "Exempt VAT needs a reason", why: "A line that is exempt from VAT needs an exemption code or reason.", fix: "Set the exemption code or reason on the VAT rate.", place: "vat" };
  }
  if (/^BR-Z-/.test(ruleId)) {
    return { title: "Zero rated VAT problem", why: "A zero rated line must use the zero rated category with a rate of zero and a matching VAT breakdown.", fix: "Check the VAT code on the lines.", place: "vat" };
  }
  if (/^BR-(AE|IC|G|O)-/.test(ruleId)) {
    return { title: "Special VAT treatment is incomplete", why: "Reverse charge, intra-Community, export and not-subject lines need extra VAT details such as VAT identifiers and an exemption reason.", fix: "Check the VAT code on the lines and the VAT numbers of both parties.", place: "vat" };
  }
  if (/^BR-CO-/.test(ruleId)) {
    return { title: "Amounts do not add up", why: "A total or a VAT amount in the invoice is not what the lines and rates give.", fix: "Check the lines, VAT codes and rounding, then regenerate. On a received invoice ask the sender for a correction.", place: "totals" };
  }
  if (/^PEPPOL-/.test(ruleId)) {
    return { title: "A Peppol rule failed", why: "The invoice breaks a Peppol network rule on top of the European standard.", fix: "Read the rule text, correct that part of the document and regenerate. On a received invoice ask the sender for a corrected file.", place: "sender" };
  }
  if (/^BR-/.test(ruleId)) {
    return { title: "A required invoice field is missing or wrong", why: "The European e-invoice standard needs a field that is missing or invalid.", fix: "Read the rule text, correct that part of the document and regenerate. On a received invoice ask the sender for a corrected file.", place: "sender" };
  }
  if (/^XSD/i.test(ruleId)) {
    return { title: "The file is not a valid e-invoice", why: "The file does not follow the UBL layout, so it cannot be read as an invoice.", fix: "Ask the sender for a new file. If Qula Plus made it, regenerate it.", place: "sender" };
  }
  return null;
}

/** What a rule means and where to fix it. Direction is the document's, from this organisation's side. */
export function explainIssue(input: { ruleId: string; businessTerm?: string | null; layer?: string | null; direction: "Sales" | "Purchases" }): IssueHelp | null {
  const id = input.ruleId.trim();
  const rule = RULES[id] ?? prefixed(id) ?? (input.layer === "xsd" ? prefixed("XSD") : null);
  if (!rule) return null;
  let where = "";
  let href: string | null = null;
  if (rule.place === "party") {
    href = input.businessTerm ? readinessHref(input.businessTerm, input.direction) : null;
    where = href === "/customers" ? "Customers" : href === "/suppliers" ? "Suppliers" : href === "/organisations" ? "Organisations" : "The supplier, customer or organisation record";
  } else if (rule.place === "vat") {
    href = "/vat-rates";
    where = "VAT rates, and the VAT code on the document lines";
  } else if (rule.place === "header") {
    where = "The document header";
  } else if (rule.place === "lines") {
    where = "The document lines";
  } else if (rule.place === "totals") {
    where = "The document lines. Totals are worked out from them.";
  } else {
    where = "Regenerate the e-invoice, or ask the sender";
  }
  return { title: rule.title, why: rule.why, fix: rule.fix, where, href };
}
