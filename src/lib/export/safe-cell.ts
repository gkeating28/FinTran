/**
 * The one place CSV text is built. Every CSV download goes through `buildCsv`, and every .xlsx download through
 * `buildXlsx` in `./xlsx`. Nothing else in the app builds export rows.
 *
 * A spreadsheet runs a text cell as a formula when it starts with =, +, - or @, and a leading tab or carriage return can
 * hide one of those. Text like that gets a leading apostrophe, which a spreadsheet reads as "this is text".
 */
export type CsvCell = string | number | null | undefined;

/** A whole number or decimal, with an optional minus sign and optional thousands commas. Nothing else. */
const PLAIN_NUMBER = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;

const FORMULA_START = /^[=+\-@\t\r]/;

/** True when the text is only a number, such as -1,234.50. A number is never a formula, so it is left as it is. */
export function isPlainNumber(text: string) {
  return PLAIN_NUMBER.test(text);
}

/** Text that a spreadsheet will not run as a formula. */
export function safeText(text: string) {
  return FORMULA_START.test(text) && !isPlainNumber(text) ? `'${text}` : text;
}

/** One CSV field, always quoted. A number is written as it is. Text is made safe first. */
export function csvField(value: CsvCell) {
  if (value === null || value === undefined) return '""';
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : safeText(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** CSV text for a header row and data rows, with CRLF line ends. */
export function buildCsv(columns: string[], rows: CsvCell[][]) {
  return [columns, ...rows].map((row) => row.map(csvField).join(",")).join("\r\n");
}
