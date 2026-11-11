import { strToU8, zipSync } from "fflate";
import { isPlainNumber } from "./safe-cell";

/**
 * A small writer for .xlsx files, enough for one sheet of text, numbers and dates with a bold header row, a frozen
 * header and a filter. An .xlsx file is a zip of XML parts, so no spreadsheet library is needed.
 */
export type XlsxType = "text" | "number" | "money" | "date";

export type XlsxColumn = { label: string; type: XlsxType };

export type XlsxCell = string | number | null;

const STYLE = { header: 1, money: 2, date: 3 } as const;

function xml(text: string) {
  // Control characters are not allowed in XML 1.0, so they are dropped. The rest is escaped.
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A column letter for a zero based index: 0 is A, 26 is AA. */
export function columnName(index: number) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Days since 1899-12-30, which is how a spreadsheet stores a date. Null when the text is not a date. */
export function excelDate(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(time) ? null : Math.round(time / 86_400_000) + 25569;
}

function sheetName(name: string) {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31);
  return cleaned || "Sheet1";
}

/** An explicit string cell. Its content is never read as a formula, whatever it starts with. */
function textCell(value: string, reference: string) {
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

/**
 * One cell. A number is a numeric cell and a date is a date cell. Everything else, including a value that does not fit
 * its column, is an explicit string cell. No formula cell (`<f>`) is ever written.
 */
function cell(column: XlsxColumn, value: XlsxCell, reference: string) {
  if (value === null || value === "") return "";
  if (column.type === "text") return textCell(String(value), reference);
  if (column.type === "date") {
    const serial = typeof value === "number" ? value : excelDate(String(value));
    return serial === null ? textCell(String(value), reference) : `<c r="${reference}" s="${STYLE.date}"><v>${serial}</v></c>`;
  }
  const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (typeof value === "string" && !isPlainNumber(value.trim())) return textCell(value, reference);
  if (!Number.isFinite(number)) return textCell(String(value), reference);
  return `<c r="${reference}"${column.type === "money" ? ` s="${STYLE.money}"` : ""}><v>${number}</v></c>`;
}

function width(column: XlsxColumn, rows: XlsxCell[][], index: number) {
  let longest = column.label.length;
  for (const row of rows.slice(0, 200)) longest = Math.max(longest, String(row[index] ?? "").length);
  return Math.min(60, Math.max(8, longest + 2));
}

export function buildXlsx(options: { sheet: string; columns: XlsxColumn[]; rows: XlsxCell[][] }): Uint8Array {
  const { columns, rows } = options;
  const last = columnName(Math.max(columns.length - 1, 0));
  const header = columns.map((column, index) => `<c r="${columnName(index)}1" s="${STYLE.header}" t="inlineStr"><is><t>${xml(column.label)}</t></is></c>`).join("");
  const body = rows
    .map((row, rowIndex) => `<row r="${rowIndex + 2}">${columns.map((column, index) => cell(column, row[index] ?? null, `${columnName(index)}${rowIndex + 2}`)).join("")}</row>`)
    .join("");
  const widths = columns.map((column, index) => `<col min="${index + 1}" max="${index + 1}" width="${width(column, rows, index)}" customWidth="1"/>`).join("");
  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths}</cols>` +
    `<sheetData><row r="1">${header}</row>${body}</sheetData>` +
    `<autoFilter ref="A1:${last}${rows.length + 1}"/>` +
    `</worksheet>`;
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="d mmm yyyy"/></numFmts>` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEFB"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>` +
    `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>` +
    `</styleSheet>`;
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName(options.sheet))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    "xl/styles.xml": strToU8(styles),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return zipSync(files, { level: 6 });
}
