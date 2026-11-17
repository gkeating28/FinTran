/**
 * The codes the standard transaction types used before every code became three characters: the first letter is the
 * direction (S Sales, P Purchases) and the other two say what the record is. A saved link or bookmark may still use
 * an old code, so a page that cannot find its type asks for the current code and sends the person there.
 */
const CURRENT_CODE: Record<string, string> = {
  PR: "PRQ",
  PO: "POR",
  PI: "PIN",
  PC: "PCN",
  SO: "SOR",
  SI: "SIN",
  SC: "SCN",
  REC: "SRC",
  PAY: "PPY",
  CREF: "SRF",
  SREF: "PRF",
  // Used briefly, as two-character codes for the payment types.
  SR: "SRC",
  PP: "PPY",
  SF: "SRF",
  PF: "PRF",
};

/** The current code for an old one, or null when the code is not an old standard code. */
export function currentCodeFor(code: string): string | null {
  return CURRENT_CODE[code.trim().toUpperCase()] ?? null;
}
