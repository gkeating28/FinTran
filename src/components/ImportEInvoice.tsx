"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import FormModal from "@/components/FormModal";
import { PartyForm } from "@/components/PartyManager";
import GridPager from "@/components/GridPager";
import { QuietInput, QuietTextarea } from "@/components/QuietField";
import { RejectEInvoice } from "@/components/RejectEInvoice";
import UnitSelect from "@/components/UnitSelect";
import { useGridPageSize } from "@/components/useGridPageSize";
import styles from "@/components/OpsPage.module.css";
import type { UnitChoice } from "@/lib/code-lists";
import { formatExchangeRate } from "@/lib/currencies";
import { sellerEndpoint, sellerIban, semanticAt, semanticRecord, semanticRows, semanticText } from "@/lib/einvoice/semantic-read";
import { gridPageSlice, pageIndexForSize, type GridPageSize } from "@/lib/grid-page";
import { formatInteger, groupThousands, numberValue } from "@/lib/numbers";
import { formatMoney, roundCents, toHome } from "@/lib/purchase-invoices";
import { clickOpensRow } from "@/lib/row-click";
import { saveSupplierPeppol } from "@/lib/party-actions";
import { ibanChanged, paymentTermsDays, suggestSupplierCode } from "@/lib/supplier-from-invoice";
import { createClient } from "@/lib/supabase/client";

type Supplier = {
  id: string;
  name: string;
  code: string;
  vat_number: string | null;
  peppol_scheme: string | null;
  peppol_id: string | null;
  currency_id: string;
};
type Vat = { id: string; code: string; description: string; vat_category: string | null; rate: number; vat_type: string };
type Named = { id: string; code: string; description: string };
type Currency = { id: string; code: string; iso_code: string | null; rate: number };
type Means = { code: string; name: string; common: boolean };
type LineChoice = { vatRateId: string; glCodeId: string; departmentId: string; costCentreId: string };
type Memory = Record<string, { glCodeId: string; departmentId: string; costCentreId: string }>;
type RuleFailure = { ruleId: string; severity: string; message: string };
type HeaderTab = "document" | "notes" | "payment";
type FlexLabels = [string, string, string, string, string];

const SPLIT_WIDTH_KEY = "fintran.transactionSplitWidth";
const SPLIT_HANDLE = 10;
const SPLIT_MIN = 280;

const splitListeners = new Set<() => void>();
let splitSnapshot: { raw: string | null; width: number | null } = { raw: null, width: null };

function emitSplitWidth() {
  for (const listener of splitListeners) listener();
}

function subscribeSplitWidth(listener: () => void) {
  splitListeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === SPLIT_WIDTH_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    splitListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function readSplitWidth() {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SPLIT_WIDTH_KEY);
  } catch {
    raw = null;
  }
  if (splitSnapshot.raw === raw) return splitSnapshot.width;
  const value = raw == null ? Number.NaN : Number(raw);
  const width = Number.isFinite(value) ? value : null;
  splitSnapshot = { raw, width };
  return width;
}

function writeSplitWidth(width: number) {
  const raw = String(width);
  try {
    window.localStorage.setItem(SPLIT_WIDTH_KEY, raw);
  } catch {
    // The divider still moves for this view when storage is blocked.
  }
  splitSnapshot = { raw, width };
  emitSplitWidth();
}

function clampSplit(width: number, container: number) {
  const max = Math.max(SPLIT_MIN, container - SPLIT_MIN - SPLIT_HANDLE);
  return Math.round(Math.min(max, Math.max(SPLIT_MIN, width)));
}

function sameId(left: string | null | undefined, right: string) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

function dateValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : "";
}

function fieldMoney(value: string) {
  if (!value) return "";
  return formatMoney(value) || value;
}

function moneyText(value: string) {
  return fieldMoney(value) || "—";
}

function invoiceVat(nett: string, rate: string) {
  if (!nett || !rate) return "";
  return formatMoney(roundCents((numberValue(nett) * numberValue(rate)) / 100));
}

function discountAmount(line: Record<string, unknown>) {
  const allowances = semanticRows(line["BG-27"]);
  if (allowances.length === 0) return formatMoney(0);
  const total = allowances.reduce((sum, entry) => sum + numberValue(semanticText(entry["BT-136"])), 0);
  return formatMoney(roundCents(total));
}

function presentedLine(line: Record<string, unknown>) {
  const item = semanticRecord(line["BG-31"]);
  const tax = semanticRecord(line["BG-30"]);
  const price = semanticRecord(line["BG-29"]);
  const name = semanticText(item?.["BT-153"]);
  const description = semanticText(item?.["BT-154"]) || name;
  const nett = semanticText(line["BT-131"]);
  const rate = semanticText(tax?.["BT-152"]);
  const allowances = semanticRows(line["BG-27"]);
  return {
    number: semanticText(line["BT-126"]),
    name,
    description,
    sellerItem: semanticText(item?.["BT-155"]),
    note: semanticText(line["BT-127"]),
    quantity: semanticText(line["BT-129"]),
    unit: semanticText(line["BT-130"]) || "C62",
    price: semanticText(price?.["BT-146"]),
    base: semanticText(price?.["BT-149"]),
    nett,
    vatCategory: semanticText(tax?.["BT-151"]),
    vatRate: rate,
    vatAmount: invoiceVat(nett, rate),
    discount: discountAmount(line),
    allowances,
  };
}

function namedCode(rows: Named[], id: string) {
  return rows.find((row) => row.id === id)?.code ?? "";
}

function vatCode(rows: Vat[], id: string) {
  return rows.find((row) => row.id === id)?.code ?? "";
}

function codeLabel(row: { code: string; description: string }) {
  return row.description ? `${row.code} — ${row.description}` : row.code;
}

export function ImportEInvoice({
  id,
  semantic,
  organisationId,
  documentNumber,
  creditNote,
  documentTitle,
  flexLabels,
  homeCurrencyId,
  missingType,
  failures,
  canReject = false,
}: {
  id: string;
  semantic: Record<string, unknown> | null;
  organisationId: string;
  documentNumber: string;
  creditNote: boolean;
  documentTitle: string;
  flexLabels: FlexLabels;
  homeCurrencyId: string;
  missingType: boolean;
  failures: RuleFailure[];
  canReject?: boolean;
}) {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rates, setRates] = useState<Vat[]>([]);
  const [glCodes, setGlCodes] = useState<Named[]>([]);
  const [departments, setDepartments] = useState<Named[]>([]);
  const [costCentres, setCostCentres] = useState<Named[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [paymentMeans, setPaymentMeans] = useState<Means[]>([]);
  const [units, setUnits] = useState<UnitChoice[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const createSupplier = false;
  const [showCreate, setShowCreate] = useState(false);
  const [savePeppol, setSavePeppol] = useState(false);
  const [countries, setCountries] = useState<{ code: string; name: string }[]>([{ code: "IE", name: "Ireland" }]);
  const [schemes, setSchemes] = useState<{ code: string; name: string }[]>([]);
  const [code, setCode] = useState("");
  const seller = semanticRecord(semantic?.["BG-4"]);
  const sellerName = semanticText(seller?.["BT-27"]);
  const [name, setName] = useState(sellerName);
  const [choices, setChoices] = useState<Record<string, LineChoice>>({});
  const [loaded, setLoaded] = useState<{ supplierId: string; memory: Memory; previousIban: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currenciesReady, setCurrenciesReady] = useState(false);
  const [headerTab, setHeaderTab] = useState<HeaderTab>("document");
  const [sideBySide, setSideBySide] = useState(true);
  const [containerWidth, setContainerWidth] = useState(0);
  const [openLine, setOpenLine] = useState<OpenLine | null>(null);
  const [lineMessage, setLineMessage] = useState<string | null>(null);
  const [linePageSize, setLinePageSize] = useGridPageSize("e-documents/import/lines", "all");
  const [linePageIndex, setLinePageIndex] = useState(0);
  const splitRef = useRef<HTMLDivElement>(null);
  const headerWidthRef = useRef<number | null>(null);
  const sideBySideRef = useRef(true);
  const storedWidth = useSyncExternalStore(subscribeSplitWidth, readSplitWidth, () => null);
  const lines = semanticRows(semantic?.["BG-25"]);
  const unsupported = Array.isArray(semantic?._unsupported) ? (semantic._unsupported as string[]) : [];
  const sellerVat = semanticText(seller?.["BT-31"]);
  const endpoint = sellerEndpoint(semantic);
  const currencyCode = semanticText(semantic?.["BT-5"]);
  const iban = sellerIban(semantic);
  const totals = semanticRecord(semantic?.["BG-22"]);
  const nett = semanticText(totals?.["BT-109"]);
  const vat = semanticText(totals?.["BT-110"]);
  const gross = semanticText(totals?.["BT-112"]);
  const due = semanticText(totals?.["BT-115"]);
  const taxes = semanticRows(semantic?.["BG-23"]);
  const grnIndex = flexLabels.findIndex((label) => label.trim().toUpperCase() === "GRN");
  const otherRefIndex = flexLabels.findIndex((label) => label.trim().toLowerCase() === "other reference");
  const showFlex = flexLabels.some((label) => label.trim());

  useEffect(() => {
    headerWidthRef.current = storedWidth;
  }, [storedWidth]);

  useEffect(() => {
    const node = splitRef.current;
    if (!node) return;
    const watch = () => {
      const wide = node.clientWidth >= 860;
      sideBySideRef.current = wide;
      setSideBySide((current) => (current === wide ? current : wide));
      setContainerWidth((current) => (current === node.clientWidth ? current : node.clientWidth));
    };
    const frame = window.requestAnimationFrame(watch);
    const observer = new ResizeObserver(watch);
    observer.observe(node);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("suppliers").select("id, name, code, vat_number, peppol_scheme, peppol_id, currency_id").eq("organisation_id", organisationId),
      supabase.from("vat_rates").select("id, code, description, vat_category, rate, vat_type").eq("organisation_id", organisationId).eq("vat_type", "Expense"),
      supabase.from("gl_codes").select("id, code, description").eq("organisation_id", organisationId).order("code"),
      supabase.from("departments").select("id, code, description").eq("organisation_id", organisationId).order("code"),
      supabase.from("cost_centres").select("id, code, description").eq("organisation_id", organisationId).order("code"),
      supabase.from("currencies").select("id, code, iso_code, rate").eq("organisation_id", organisationId),
      supabase.from("ref_payment_means").select("code, name, common").eq("active", true),
      supabase.from("ref_units").select("code, name, common").eq("active", true),
    ]).then(([supplierResult, vatResult, glResult, departmentResult, costResult, currencyResult, meansResult, unitResult]) => {
      setSuppliers((supplierResult.data ?? []) as Supplier[]);
      setRates((vatResult.data ?? []) as Vat[]);
      setGlCodes((glResult.data ?? []) as Named[]);
      setDepartments((departmentResult.data ?? []) as Named[]);
      setCostCentres((costResult.data ?? []) as Named[]);
      setCurrencies((currencyResult.data ?? []) as Currency[]);
      setCurrenciesReady(!currencyResult.error);
      const means = ((meansResult.data ?? []) as Means[]).slice().sort((left, right) => Number(right.common) - Number(left.common) || left.code.localeCompare(right.code));
      setPaymentMeans(means);
      setUnits(((unitResult.data ?? []) as UnitChoice[]).slice().sort((left, right) => Number(right.common) - Number(left.common) || left.code.localeCompare(right.code)));
    });
  }, [organisationId]);

  useEffect(() => {
    if (!showCreate || schemes.length > 0) return;
    const supabase = createClient();
    void Promise.all([
      supabase.from("ref_countries").select("code, name").order("name"),
      supabase.from("ref_eas").select("code, name").order("code"),
    ]).then(([countryResult, schemeResult]) => {
      const loadedCountries = (countryResult.data ?? []) as { code: string; name: string }[];
      if (loadedCountries.length) setCountries(loadedCountries);
      setSchemes((schemeResult.data ?? []) as { code: string; name: string }[]);
    });
  }, [showCreate, schemes.length]);

  const peppolMatch = suppliers.find(
    (supplier) => supplier.peppol_scheme === endpoint.scheme && sameId(supplier.peppol_id, endpoint.id),
  );
  const vatMatch = suppliers.find((supplier) => sameId(supplier.vat_number, sellerVat));
  const matched = peppolMatch ?? vatMatch;
  const selected = suppliers.find((supplier) => supplier.id === (supplierId || matched?.id || ""));
  const invoiceCurrency = currencies.find((currency) => currency.iso_code === currencyCode || currency.code === currencyCode);
  const currencyBlocked = !createSupplier && Boolean(selected) && selected?.currency_id !== invoiceCurrency?.id;
  const effectiveSupplierId = createSupplier ? "" : supplierId || matched?.id || "";
  const memory = loaded?.supplierId === effectiveSupplierId ? loaded.memory : {};
  const previousIban = loaded?.supplierId === effectiveSupplierId ? loaded.previousIban : null;
  const rateText = invoiceCurrency ? formatExchangeRate(invoiceCurrency.rate) : "";
  const currencyLabel = invoiceCurrency?.code || currencyCode;
  const homeCurrency = currencies.find((currency) => currency.id === homeCurrencyId);
  const showHome = Boolean(homeCurrency && currencyLabel && homeCurrency.code.toUpperCase() !== currencyLabel.toUpperCase());
  const supplierReady = createSupplier ? code.trim().length > 0 : Boolean(effectiveSupplierId);
  const blocked = unsupported.length > 0 || !invoiceCurrency || currencyBlocked || missingType || saving || !supplierReady;
  const linePage = gridPageSlice(lines, linePageIndex, linePageSize);
  const splitMax = containerWidth ? Math.max(SPLIT_MIN, containerWidth - SPLIT_MIN - SPLIT_HANDLE) : 1200;
  const splitStyle: CSSProperties = sideBySide
    ? {
        gridTemplateColumns: storedWidth == null ? "minmax(0, 1fr) 10px minmax(0, 1fr)" : `${storedWidth}px 10px minmax(0, 1fr)`,
      }
    : {
        gridTemplateColumns: "minmax(0, 1fr)",
        gridTemplateRows: "minmax(0, 1fr) minmax(0, 1fr)",
      };
  const paymentCode = semanticAt(semantic, "BG-16", "BT-81");
  const means = !paymentCode || paymentMeans.some((meansRow) => meansRow.code === paymentCode)
    ? paymentMeans
    : [{ code: paymentCode, name: paymentCode, common: false }, ...paymentMeans];
  const contact = [
    semanticAt(seller, "BG-5", "BT-35"),
    semanticAt(seller, "BG-5", "BT-36"),
    semanticAt(seller, "BG-5", "BT-162"),
    [semanticAt(seller, "BG-5", "BT-37"), semanticAt(seller, "BG-5", "BT-38")].filter(Boolean).join(" "),
    semanticAt(seller, "BG-5", "BT-39"),
    semanticAt(seller, "BG-5", "BT-40"),
    sellerVat ? `VAT ${sellerVat}` : "",
    endpoint.id ? `Peppol ${endpoint.scheme}:${endpoint.id}` : "",
    iban ? `IBAN ${iban}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  useEffect(() => {
    if (!effectiveSupplierId) return;
    const supplier = effectiveSupplierId;
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("transaction_headers")
      .select("id, created_at")
      .eq("organisation_id", organisationId)
      .eq("supplier_id", supplier)
      .then(async ({ data }) => {
        if (cancelled) return;
        const headers = (data ?? []) as { id: string; created_at: string }[];
        const headerIds = headers.map((row) => row.id);
        if (headerIds.length === 0) {
          setLoaded({ supplierId: supplier, memory: {}, previousIban: null });
          return;
        }
        const documentResult = await supabase
          .from("e_documents")
          .select("semantic, created_at, header_id")
          .eq("organisation_id", organisationId)
          .eq("direction", "inbound")
          .eq("status", "imported")
          .in("header_id", headerIds)
          .order("created_at", { ascending: false });
        if (cancelled) return;
        const imported = (documentResult.data ?? []) as { semantic?: unknown; header_id: string; created_at: string }[];
        const importedIds = imported.map((row) => row.header_id);
        const newestFirst = new Map(imported.map((row, index) => [row.header_id, index]));
        const lineResult = importedIds.length
          ? await supabase
              .from("transaction_lines")
              .select("seller_item_id, gl_code_id, department_id, cost_centre_id, header_id")
              .in("header_id", importedIds)
          : { data: [] };
        if (cancelled) return;
        const next: Memory = {};
        const orderedLines = [...(lineResult.data ?? [])].sort(
          (left, right) => (newestFirst.get(String(left.header_id)) ?? 0) - (newestFirst.get(String(right.header_id)) ?? 0),
        );
        for (const line of orderedLines) {
          const item = String(line.seller_item_id ?? "");
          if (!item || next[item]) continue;
          next[item] = {
            glCodeId: String(line.gl_code_id ?? ""),
            departmentId: String(line.department_id ?? ""),
            costCentreId: String(line.cost_centre_id ?? ""),
          };
        }
        const previous = imported[0];
        setLoaded({
          supplierId: supplier,
          memory: next,
          previousIban: previous ? sellerIban(previous.semantic) : null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveSupplierId, organisationId]);

  function choiceFor(line: Record<string, unknown>): LineChoice {
    const number = semanticText(line["BT-126"]);
    const item = semanticAt(line, "BG-31", "BT-155");
    const category = semanticAt(line, "BG-30", "BT-151");
    const rate = semanticAt(line, "BG-30", "BT-152");
    const suggested = rates.find((entry) => entry.vat_category === category && Number(entry.rate) === Number(rate));
    const remembered = memory[item];
    return {
      vatRateId: choices[number]?.vatRateId || suggested?.id || "",
      glCodeId: choices[number]?.glCodeId || remembered?.glCodeId || "",
      departmentId: choices[number]?.departmentId || remembered?.departmentId || "",
      costCentreId: choices[number]?.costCentreId || remembered?.costCentreId || "",
    };
  }

  function setChoice(number: string, patch: Partial<LineChoice>) {
    const line = lines.find((entry) => semanticText(entry["BT-126"]) === number);
    setChoices((current) => ({
      ...current,
      [number]: { ...(line ? choiceFor(line) : { vatRateId: "", glCodeId: "", departmentId: "", costCentreId: "" }), ...current[number], ...patch },
    }));
  }

  function close() {
    router.push("/e-documents?direction=inbound");
  }

  function paintWidth(width: number) {
    const node = splitRef.current;
    if (!node) return;
    node.style.gridTemplateColumns = `${width}px ${SPLIT_HANDLE}px minmax(0, 1fr)`;
  }

  function rememberWidth(next: number) {
    const node = splitRef.current;
    const width = node ? clampSplit(next, node.clientWidth) : next;
    headerWidthRef.current = width;
    paintWidth(width);
    writeSplitWidth(width);
  }

  function dragSplit(event: PointerEvent<HTMLButtonElement>) {
    if (!sideBySideRef.current) return;
    const node = splitRef.current;
    if (!node) return;
    event.preventDefault();
    const bounds = node.getBoundingClientRect();
    const origin = headerWidthRef.current ?? (bounds.width - SPLIT_HANDLE) / 2;
    const startX = event.clientX;
    const target = event.currentTarget;
    let latest = origin;
    let frame = 0;
    target.setPointerCapture(event.pointerId);
    const move = (ev: globalThis.PointerEvent) => {
      latest = clampSplit(origin + ev.clientX - startX, bounds.width);
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        paintWidth(latest);
      });
    };
    const stop = (ev: globalThis.PointerEvent) => {
      if (frame) window.cancelAnimationFrame(frame);
      latest = clampSplit(origin + ev.clientX - startX, bounds.width);
      rememberWidth(latest);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function nudgeSplit(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const node = splitRef.current;
    if (!node || !sideBySide) return;
    event.preventDefault();
    const current = headerWidthRef.current ?? (node.clientWidth - SPLIT_HANDLE) / 2;
    const delta = event.key === "ArrowLeft" ? -24 : 24;
    rememberWidth(current + (event.shiftKey ? delta * 3 : delta));
  }

  function changeLinePageSize(next: GridPageSize) {
    setLinePageIndex(pageIndexForSize(linePage.page, linePageSize, lines.length, next));
    setLinePageSize(next);
  }

  function openEditor(line: Record<string, unknown>) {
    const view = presentedLine(line);
    setLineMessage(null);
    setOpenLine({
      number: view.number,
      sellerItem: view.sellerItem,
      source: line,
      ...choiceFor(line),
    });
  }

  function saveLine() {
    if (!openLine) return;
    if (!openLine.vatRateId) {
      setLineMessage("Choose a VAT code.");
      return;
    }
    setChoice(openLine.number, {
      vatRateId: openLine.vatRateId,
      glCodeId: openLine.glCodeId,
      departmentId: openLine.departmentId,
      costCentreId: openLine.costCentreId,
    });
    setOpenLine(null);
  }

  const ibanWarning = ibanChanged(previousIban, iban);
  const title = documentTitle ? `Import ${documentTitle}` : "Import e-invoice";
  const statusText = unsupported.length
    ? `This e-invoice uses features Qula Tran cannot import yet: ${unsupported.join(", ")}`
    : missingType
      ? "Choose the default Purchases document type before importing."
      : currenciesReady && !invoiceCurrency
        ? `Add the invoice currency ${currencyCode || ""} to this organisation before importing.`
        : currencyBlocked
          ? "The supplier currency must match the e-invoice currency."
          : ibanWarning
            ? `This IBAN differs from the account on the last imported e-invoice from this supplier${previousIban ? ` (${previousIban})` : ""}.`
            : failures.length
              ? failures.map((failure) => `${failure.severity} ${failure.ruleId}: ${failure.message}`).join(" ")
              : error
                ? error
                : null;

  return (
    <>
      <FormModal title={title} onClose={close} fillPage>
        <div className={styles.modalForm}>
          <form
            id="import-document"
            className={styles.documentFields}
            autoComplete="off"
            onSubmit={async (event) => {
              event.preventDefault();
              if (saving) return;
              setError(null);
              if (unsupported.length) {
                setError(`This e-invoice uses features Qula Tran cannot import yet: ${unsupported.join(", ")}`);
                return;
              }
              if (missingType) {
                setError("Choose the default Purchases document type before importing.");
                return;
              }
              if (!invoiceCurrency) {
                setError("Add the invoice currency to this organisation before importing.");
                return;
              }
              if (currencyBlocked) {
                setError("The supplier currency must match the e-invoice currency.");
                return;
              }
              if (!supplierReady) {
                setError(createSupplier ? "Enter a supplier code." : "Choose a supplier.");
                return;
              }
              const missingVat = lines.some((line) => !choiceFor(line).vatRateId);
              if (missingVat) {
                setError("Choose a VAT code on every line.");
                return;
              }
              setSaving(true);
              if (savePeppol && effectiveSupplierId && endpoint.id) {
                const saved = await saveSupplierPeppol(effectiveSupplierId, endpoint.scheme, endpoint.id);
                if (saved.error) {
                  setSaving(false);
                  setError(saved.error);
                  return;
                }
              }
              const supabase = createClient();
              const { data, error: imported } = await supabase.rpc("import_e_document", {
                p_id: id,
                p_choices: {
                  supplierId: effectiveSupplierId || null,
                  lines: lines.map((line) => {
                    const number = semanticText(line["BT-126"]);
                    const selectedLine = choiceFor(line);
                    return {
                      lineNumber: number,
                      vatRateId: selectedLine.vatRateId,
                      glCodeId: selectedLine.glCodeId || null,
                      departmentId: selectedLine.departmentId || null,
                      costCentreId: selectedLine.costCentreId || null,
                    };
                  }),
                },
              });
              if (imported) {
                setSaving(false);
                setError(imported.message);
                return;
              }
              const header = await supabase.from("transaction_headers").select("transaction_types(code)").eq("id", data).maybeSingle();
              const type = header.data?.transaction_types as { code?: string } | { code?: string }[] | null;
              const typeCode = Array.isArray(type) ? type[0]?.code : type?.code;
              router.push(typeCode ? `/transactions/${typeCode}?open=${data ?? ""}` : "/transactions");
              router.refresh();
            }}
          >
            <div className={styles.statusRow}>
              <p
                className={statusText ? styles.alert : styles.notice}
                role={statusText ? "alert" : "status"}
                title={statusText ?? "Received and valid. The document is read-only, except the supplier and the line codes."}
              >
                {statusText ?? "Received and valid. The document is read-only, except the supplier and the line codes."}
              </p>
              <div className={styles.readinessBar}>
                <a className={styles.quiet} href={`/api/einvoice/${id}/xml`}>
                  Download XML
                </a>
              </div>
            </div>
            <div className={`${styles.invoiceSplit} ${sideBySide ? "" : styles.invoiceStacked}`} ref={splitRef} style={splitStyle}>
              <div className={styles.headerPane}>
                <div className={styles.headerTabs} role="tablist" aria-label="Header">
                  {([
                    ["document", "Document"],
                    ["notes", "Notes"],
                    ["payment", "Payment"],
                  ] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      className={styles.headerTab}
                      type="button"
                      role="tab"
                      id={`header-tab-${tab}`}
                      aria-selected={headerTab === tab}
                      aria-controls={`header-panel-${tab}`}
                      tabIndex={headerTab === tab ? 0 : -1}
                      onClick={() => setHeaderTab(tab)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.headerBody}>
                  <div
                    className={`${styles.invoiceForm} ${styles.headerFields}`}
                    id="header-panel-document"
                    role="tabpanel"
                    aria-labelledby="header-tab-document"
                    hidden={headerTab !== "document"}
                  >
                    <label className={styles.field}>
                      Number
                      <input readOnly value="Draft" className={styles.mono} />
                    </label>
                    {showFlex && otherRefIndex >= 0 ? (
                      <label className={styles.field}>
                        {flexLabels[otherRefIndex]}
                        <input value="" disabled />
                      </label>
                    ) : (
                      <span />
                    )}
                    <label className={styles.field}>
                      Supplier code
                      {createSupplier ? (
                        <input
                          value={code}
                          onChange={(event) => setCode(event.target.value.toUpperCase())}
                          maxLength={20}
                          className={styles.mono}
                        />
                      ) : (
                        <select
                          value={supplierId || matched?.id || ""}
                          onChange={(event) => {
                            if (event.target.value === "new") {
                              setShowCreate(true);
                              return;
                            }
                            setSupplierId(event.target.value);
                          }}
                        >
                          <option value="">Choose a supplier</option>
                          <option value="new">Create New</option>
                          {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>
                              {supplier.code} — {supplier.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </label>
                    <label className={styles.field}>
                      Supplier name
                      <QuietInput
                        maxLength={200}
                        disabled={!createSupplier}
                        value={createSupplier ? name : selected?.name || sellerName}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </label>
                    <div className={styles.fieldPair}>
                      <label className={styles.field}>
                        Currency
                        <input readOnly value={currencyLabel} className={styles.mono} />
                      </label>
                      <label className={styles.field}>
                        Exchange rate
                        <input disabled value={rateText} className={styles.mono} />
                      </label>
                    </div>
                    <div className={styles.fieldPair}>
                      <label className={styles.field}>
                        Transaction date
                        <input type="date" disabled value={dateValue(semanticText(semantic?.["BT-2"]))} />
                      </label>
                      <label className={styles.field}>
                        Due date
                        <input type="date" disabled value={dateValue(semanticText(semantic?.["BT-9"]))} />
                      </label>
                    </div>
                    <label className={styles.field}>
                      Supplier invoice no.
                      <input disabled value={documentNumber || semanticText(semantic?.["BT-1"])} />
                    </label>
                    <div className={styles.fieldPair}>
                      <label className={styles.field}>
                        Supply date
                        <input type="date" disabled value={dateValue(semanticText(semantic?.["BT-72"]))} />
                      </label>
                      {showFlex && grnIndex >= 0 ? (
                        <label className={styles.field}>
                          {flexLabels[grnIndex]}
                          <input value="" disabled />
                        </label>
                      ) : null}
                    </div>
                    <label className={styles.field}>
                      Order number
                      <input disabled value={semanticText(semantic?.["BT-13"])} />
                    </label>
                    <label className={styles.field}>
                      Buyer reference
                      <input disabled value={semanticText(semantic?.["BT-10"])} />
                    </label>
                    <label className={styles.field}>
                      Contract reference
                      <input disabled value={semanticText(semantic?.["BT-12"])} />
                    </label>
                    <div className={styles.fieldPair}>
                      <label className={styles.field}>
                        Period start
                        <input type="date" disabled value={dateValue(semanticAt(semantic, "BG-14", "BT-73"))} />
                      </label>
                      <label className={styles.field}>
                        Period end
                        <input type="date" disabled value={dateValue(semanticAt(semantic, "BG-14", "BT-74"))} />
                      </label>
                      <span className={`${styles.panelMeta} ${styles.wide}`}>Enter both dates, or leave both blank.</span>
                    </div>
                    {showFlex
                      ? flexLabels.map((label, index) =>
                          index === grnIndex || index === otherRefIndex || !label.trim() ? null : (
                            <label key={`${label}-${index}`} className={styles.field}>
                              {label}
                              <input value="" disabled />
                            </label>
                          ),
                        )
                      : null}
                    {creditNote ? (
                      <>
                        <label className={`${styles.field} ${styles.wide}`}>
                          Credits invoice
                          <input disabled value={semanticAt(semantic, "BG-3", "BT-25")} />
                        </label>
                        <label className={styles.field}>
                          Preceding invoice
                          <input disabled value={semanticAt(semantic, "BG-3", "BT-25")} />
                        </label>
                        <label className={styles.field}>
                          Preceding date
                          <input type="date" disabled value={dateValue(semanticAt(semantic, "BG-3", "BT-26"))} />
                        </label>
                        <p className={`${styles.panelMeta} ${styles.wide}`}>
                          A credit note needs the invoice it applies to before it can be posted. Choose a posted invoice for this supplier, or type the reference and date.
                        </p>
                      </>
                    ) : null}
                    <p className={`${styles.panelMeta} ${styles.wide}`}>
                      {peppolMatch
                        ? `Matched supplier ${peppolMatch.code} — ${peppolMatch.name} by Peppol ID. `
                        : matched
                          ? `Matched supplier ${matched.code} — ${matched.name} by VAT number. `
                          : "No supplier matched. Choose Create New, or choose an existing supplier."}
                    </p>
                    {vatMatch && !peppolMatch && !vatMatch.peppol_id && endpoint.id ? (
                      <label className={`${styles.checkLine} ${styles.wide}`}>
                        <input type="checkbox" checked={savePeppol} onChange={(event) => setSavePeppol(event.target.checked)} />
                        Save this Peppol ID to the supplier
                      </label>
                    ) : null}
                  </div>
                  <div
                    className={`${styles.invoiceForm} ${styles.headerFields}`}
                    id="header-panel-notes"
                    role="tabpanel"
                    aria-labelledby="header-tab-notes"
                    hidden={headerTab !== "notes"}
                  >
                    <label className={`${styles.field} ${styles.wide}`}>
                      Notes
                      <QuietTextarea value={semanticText(semantic?.["BT-22"])} maxLength={4000} rows={8} disabled />
                    </label>
                  </div>
                  <div
                    className={`${styles.invoiceForm} ${styles.headerFields}`}
                    id="header-panel-payment"
                    role="tabpanel"
                    aria-labelledby="header-tab-payment"
                    hidden={headerTab !== "payment"}
                  >
                    <label className={styles.field}>
                      Payment means
                      <select value={paymentCode} disabled>
                        <option value="">No payment means</option>
                        {means.some((meansRow) => meansRow.common) ? (
                          <optgroup label="Common">
                            {means
                              .filter((meansRow) => meansRow.common)
                              .map((meansRow) => (
                                <option key={meansRow.code} value={meansRow.code}>
                                  {meansRow.code} — {meansRow.name}
                                </option>
                              ))}
                          </optgroup>
                        ) : null}
                        <optgroup label="All">
                          {means
                            .filter((meansRow) => !meansRow.common)
                            .map((meansRow) => (
                              <option key={meansRow.code} value={meansRow.code}>
                                {meansRow.code} — {meansRow.name}
                              </option>
                            ))}
                        </optgroup>
                      </select>
                    </label>
                    <label className={`${styles.field} ${styles.wide}`}>
                      Payment terms
                      <QuietTextarea value={semanticText(semantic?.["BT-20"])} maxLength={400} rows={2} disabled />
                    </label>
                    <label className={styles.field}>
                      Rounding
                      <input disabled value={fieldMoney(semanticText(totals?.["BT-114"]) || "0")} className={styles.mono} />
                    </label>
                    <label className={styles.field}>
                      Paid amount
                      <input disabled value={fieldMoney(semanticText(totals?.["BT-113"]) || "0")} className={styles.mono} />
                    </label>
                    <label className={`${styles.field} ${styles.wide}`}>
                      Contact details
                      <QuietTextarea value={contact} maxLength={500} rows={4} disabled />
                    </label>
                  </div>
                </div>
                <div className={styles.headerSummary}>
                  <fieldset className={styles.amountBox}>
                    <legend>Totals</legend>
                    <table>
                      <thead>
                        <tr>
                          <th />
                          <th>Nett</th>
                          <th>VAT</th>
                          <th>Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <th>{currencyLabel || "—"}</th>
                          <td className={styles.mono}>{moneyText(nett)}</td>
                          <td className={styles.mono}>{moneyText(vat)}</td>
                          <td className={styles.mono}>{moneyText(gross)}</td>
                        </tr>
                        {showHome && homeCurrency ? (
                          <tr>
                            <th>{homeCurrency.code}</th>
                            <td className={styles.mono}>{formatMoney(toHome(numberValue(nett), rateText))}</td>
                            <td className={styles.mono}>{formatMoney(toHome(numberValue(vat), rateText))}</td>
                            <td className={styles.mono}>{formatMoney(toHome(numberValue(gross), rateText))}</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                    <p className={styles.panelMeta}>Amount due {moneyText(due)}</p>
                    {taxes.length ? (
                      <table className={styles.vatBreakdown}>
                        <thead>
                          <tr>
                            <th>Category</th>
                            <th>Rate</th>
                            <th>Taxable</th>
                            <th>VAT</th>
                            <th>Exemption</th>
                          </tr>
                        </thead>
                        <tbody>
                          {taxes.map((row) => {
                            const category = semanticText(row["BT-118"]);
                            const percent = semanticText(row["BT-119"]);
                            return (
                              <tr key={`${category}-${percent}`}>
                                <td className={styles.mono}>{category || "—"}</td>
                                <td className={styles.mono}>{percent ? `${Number(percent).toFixed(2)}%` : "—"}</td>
                                <td className={styles.mono}>{moneyText(semanticText(row["BT-116"]))}</td>
                                <td className={styles.mono}>{moneyText(semanticText(row["BT-117"]))}</td>
                                <td>{semanticText(row["BT-120"]) || "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : null}
                  </fieldset>
                </div>
              </div>
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
              <div className={styles.linesPane}>
                <div className={styles.gridToolbar}>
                  <span className={styles.paneLabel}>
                    Lines ({lines.length})
                    {lines.length > 0 ? <span className={styles.lineHint}>Select a line to see its details.</span> : null}
                  </span>
                </div>
                <div className={styles.lineScroll}>
                  <table className={styles.lineTable}>
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Product</th>
                        <th>Description</th>
                        <th>Unit</th>
                        <th>GL</th>
                        <th>VAT</th>
                        <th className={styles.num}>Qty</th>
                        <th className={styles.num}>Nett</th>
                        <th className={styles.num}>VAT amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.length === 0 ? (
                        <tr>
                          <td colSpan={9}>No lines yet.</td>
                        </tr>
                      ) : (
                        linePage.rows.map((line) => {
                          const view = presentedLine(line);
                          const selectedLine = choiceFor(line);
                          return (
                            <tr
                              key={view.number}
                              className={styles.lineClick}
                              tabIndex={0}
                              role="button"
                              aria-label={`View line ${view.number}`}
                              onClick={(event) => {
                                if (clickOpensRow(event.target)) openEditor(line);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                openEditor(line);
                              }}
                            >
                              <td className={styles.mono}>{view.number}</td>
                              <td className={styles.mono}>{view.sellerItem}</td>
                              <td>{view.description}</td>
                              <td className={styles.mono}>{view.unit}</td>
                              <td className={styles.mono}>{namedCode(glCodes, selectedLine.glCodeId)}</td>
                              <td className={styles.mono}>{vatCode(rates, selectedLine.vatRateId)}</td>
                              <td className={`${styles.mono} ${styles.num}`}>{moneyText(view.quantity)}</td>
                              <td className={`${styles.mono} ${styles.num}`}>{moneyText(view.nett)}</td>
                              <td className={`${styles.mono} ${styles.num}`}>{view.vatAmount || "—"}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={7}>Total</th>
                        <td className={`${styles.mono} ${styles.num}`}>{moneyText(nett)}</td>
                        <td className={`${styles.mono} ${styles.num}`}>{moneyText(vat)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <GridPager
                  className={styles.linePager}
                  page={linePage.page}
                  pageCount={linePage.pageCount}
                  pageSize={linePageSize}
                  onPage={setLinePageIndex}
                  onPageSize={changeLinePageSize}
                  summary={
                    lines.length === 0
                      ? "No lines"
                      : `Showing ${formatInteger(linePage.from)} to ${formatInteger(linePage.to)} of ${formatInteger(lines.length)}`
                  }
                />
              </div>
            </div>
          </form>
          <div className={styles.modalActions}>
            <div className={styles.actionCluster}>
              {canReject ? <RejectEInvoice id={id} className={styles.quiet} /> : null}
            </div>
            <div className={styles.actionCluster}>
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
      {showCreate ? (
        <PartyForm
          kind="suppliers"
          row={null}
          currencies={currencies.map((currency) => ({ id: currency.id, code: currency.code, name: currency.code }))}
          countries={countries}
          schemes={schemes}
          homeCurrencyId={homeCurrencyId}
          notice={currencies.some((currency) => currency.iso_code === semanticText(semantic?.["BT-5"]) || currency.code === semanticText(semantic?.["BT-5"])) ? null : `Add the invoice currency ${semanticText(semantic?.["BT-5"])} before saving this supplier.`}
          blockSave={!currencies.some((currency) => currency.iso_code === semanticText(semantic?.["BT-5"]) || currency.code === semanticText(semantic?.["BT-5"]))}
          seed={{
            code: suggestSupplierCode(sellerName, suppliers.map((supplier) => supplier.code)),
            name: sellerName,
            vatNumber: semanticText(seller?.["BT-31"]),
            companyNumber: semanticText(seller?.["BT-30"]),
            peppolScheme: endpoint.scheme,
            peppolId: endpoint.id,
            addressLine1: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-35"]),
            addressLine2: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-36"]),
            addressLine3: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-162"]),
            city: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-37"]),
            postCode: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-38"]),
            county: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-39"]),
            countryCode: semanticText(semanticRecord(seller?.["BG-5"])?.["BT-40"]) || "IE",
            email: semanticText(semanticRecord(seller?.["BG-6"])?.["BT-43"]),
            phone: semanticText(semanticRecord(seller?.["BG-6"])?.["BT-42"]),
            paymentTermsDays: paymentTermsDays(semanticText(semantic?.["BT-2"]), semanticText(semantic?.["BT-9"])),
            currencyId: invoiceCurrency?.id ?? "",
          }}
          onSaved={(savedCode) => {
            const supabase = createClient();
            void supabase.from("suppliers").select("id, name, code, vat_number, peppol_scheme, peppol_id, currency_id").eq("organisation_id", organisationId).then((result) => {
              const list = (result.data ?? []) as Supplier[];
              setSuppliers(list);
              const created = list.find((supplier) => supplier.code === savedCode);
              if (created) setSupplierId(created.id);
            });
          }}
          onClose={() => setShowCreate(false)}
        />
      ) : null}
    </>
  );
}

type OpenLine = LineChoice & {
  number: string;
  sellerItem: string;
  source: Record<string, unknown>;
};

function LineCoding({
  line,
  message,
  rates,
  glCodes,
  departments,
  costCentres,
  units,
  onChange,
  onSave,
  onCancel,
}: {
  line: OpenLine;
  message: string | null;
  rates: Vat[];
  glCodes: Named[];
  departments: Named[];
  costCentres: Named[];
  units: UnitChoice[];
  onChange: (line: OpenLine) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const view = presentedLine(line.source);
  const unitChoices =
    !view.unit || units.some((unit) => unit.code === view.unit) ? units : [{ code: view.unit, name: view.unit, common: true }, ...units];
  const extras = [
    view.name && view.name !== view.description ? `Item name ${view.name}` : "",
    view.base ? `Base quantity ${view.base}` : "",
    view.vatCategory || view.vatRate ? `Invoice VAT ${[view.vatCategory, view.vatRate ? `${view.vatRate}%` : ""].filter(Boolean).join(" ")}` : "",
    ...view.allowances.map((entry, index) => {
      const amount = semanticText(entry["BT-136"]);
      const reason = semanticText(entry["BT-140"]);
      return [`Allowance ${index + 1} ${amount}`, reason ? `reason ${reason}` : ""].filter(Boolean).join(", ");
    }),
  ].filter(Boolean);

  return (
    <FormModal title={`Edit line ${line.number}`} onClose={onCancel} className={styles.lineDialog}>
      <form
        className={`${styles.modalForm} ${styles.partyForm}`}
        autoComplete="off"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        {message ? (
          <p className={styles.alert} role="alert">
            {message}
          </p>
        ) : null}
        <label className={styles.field}>
          Product code
          <select value="" disabled>
            <option value="">No product</option>
          </select>
        </label>
        <label className={styles.field}>
          Description
          <QuietInput value={view.description} maxLength={200} disabled />
        </label>
        <label className={styles.field}>
          Unit
          <UnitSelect units={unitChoices} value={view.unit} disabled />
        </label>
        <label className={styles.field}>
          Seller item
          <QuietInput value={view.sellerItem} maxLength={60} disabled />
        </label>
        <label className={`${styles.field} ${styles.wide}`}>
          Line note
          <QuietTextarea value={view.note} maxLength={400} rows={2} disabled />
        </label>
        <label className={styles.field}>
          GL code
          <select autoComplete="off" value={line.glCodeId} onChange={(event) => onChange({ ...line, glCodeId: event.target.value })}>
            <option value="">No GL code</option>
            {glCodes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {codeLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Department code
          <select autoComplete="off" value={line.departmentId} onChange={(event) => onChange({ ...line, departmentId: event.target.value })}>
            <option value="">No department</option>
            {departments.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {codeLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Cost centre code
          <select autoComplete="off" value={line.costCentreId} onChange={(event) => onChange({ ...line, costCentreId: event.target.value })}>
            <option value="">No cost centre</option>
            {costCentres.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {codeLabel(entry)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          VAT code
          <select autoComplete="off" value={line.vatRateId} onChange={(event) => onChange({ ...line, vatRateId: event.target.value })}>
            <option value="">Choose a VAT code</option>
            {rates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} — {entry.description} ({groupThousands(entry.rate)}%)
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Quantity
          <QuietInput className={styles.mono} value={fieldMoney(view.quantity)} disabled />
        </label>
        <label className={styles.field}>
          Price
          <QuietInput className={styles.mono} value={fieldMoney(view.price)} disabled />
        </label>
        <label className={styles.field}>
          Discount amount
          <QuietInput className={styles.mono} value={view.discount} disabled />
        </label>
        <p className={`${styles.panelMeta} ${styles.wide}`}>
          Nett {moneyText(view.nett)} · VAT {view.vatAmount || "—"}
        </p>
        {extras.length ? <p className={`${styles.panelMeta} ${styles.wide}`}>{extras.join(" · ")}</p> : null}
        <div className={styles.modalActions}>
          <button className={styles.quiet} type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className={styles.primary} type="submit">
            Save line
          </button>
        </div>
      </form>
    </FormModal>
  );
}
