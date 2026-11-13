"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useGridLines } from "@/components/GridLines";
import { useGridPageSize } from "@/components/useGridPageSize";
import type { UnitChoice } from "@/lib/code-lists";
import { formatExchangeRate } from "@/lib/currencies";
import { sellerEndpoint, sellerIban, semanticAt, semanticRecord, semanticRows, semanticText } from "@/lib/einvoice/semantic-read";
import { gridPageSlice, pageIndexForSize, type GridPageSize } from "@/lib/grid-page";
import { saveSupplierPeppol } from "@/lib/party-actions";
import { ibanChanged } from "@/lib/supplier-from-invoice";
import { createClient } from "@/lib/supabase/client";
import type { Currency, FlexLabels, HeaderTab, LineChoice, Means, Memory, Named, OpenLine, PurchaseType, RuleFailure, Supplier, Vat } from "./types";
import { presentedLine, sameId } from "./format";
import { useImportSplit } from "./useImportSplit";

export type ImportFormProps = {
  id: string;
  semantic: Record<string, unknown> | null;
  organisationId: string;
  documentNumber: string;
  creditNote: boolean;
  documentTitle: string;
  flexLabels: FlexLabels;
  homeCurrencyId: string;
  defaultTypeId?: string;
  failures: RuleFailure[];
  canReject?: boolean;
};

export type ImportFormState = ReturnType<typeof useImportForm>;

/** Everything the import screen needs: the lists it loads, the choices made, what blocks Save, and the handlers. */
export function useImportForm({ id, semantic, organisationId, documentNumber, creditNote, documentTitle, flexLabels, homeCurrencyId, defaultTypeId = "", failures, canReject = false }: ImportFormProps) {
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
  const [purchaseTypes, setPurchaseTypes] = useState<PurchaseType[]>([]);
  const [typesReady, setTypesReady] = useState(false);
  const [typeId, setTypeId] = useState(defaultTypeId);
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
  const [openLine, setOpenLine] = useState<OpenLine | null>(null);
  const [lineMessage, setLineMessage] = useState<string | null>(null);
  const [linePageSize, setLinePageSize] = useGridPageSize("e-documents/import/lines", "all");
  const lineGridLines = useGridLines("e-documents/import/lines");
  const [linePageIndex, setLinePageIndex] = useState(0);
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
  const selectedPurchaseType = purchaseTypes.find((type) => type.id === typeId);
  const activeFlexLabels: FlexLabels = selectedPurchaseType
    ? [
        selectedPurchaseType.flex1_label ?? "",
        selectedPurchaseType.flex2_label ?? "",
        selectedPurchaseType.flex3_label ?? "",
        selectedPurchaseType.flex4_label ?? "",
        selectedPurchaseType.flex5_label ?? "",
      ]
    : flexLabels;
  const grnIndex = activeFlexLabels.findIndex((label) => label.trim().toUpperCase() === "GRN");
  const otherRefIndex = activeFlexLabels.findIndex((label) => label.trim().toLowerCase() === "other reference");
  const showFlex = activeFlexLabels.some((label) => label.trim());
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
      supabase.from("transaction_types").select("id, code, description, document_kind, flex1_label, flex2_label, flex3_label, flex4_label, flex5_label").eq("organisation_id", organisationId).eq("type", "Purchases").order("code"),
    ]).then(([supplierResult, vatResult, glResult, departmentResult, costResult, currencyResult, meansResult, unitResult, typeResult]) => {
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
      const wanted = creditNote ? "credit_note" : "invoice";
      const loadedTypes = ((typeResult.data ?? []) as PurchaseType[]).filter((type) => type.document_kind === wanted);
      setPurchaseTypes(loadedTypes);
      setTypeId((current) => current || (loadedTypes.length === 1 ? loadedTypes[0].id : ""));
      setTypesReady(!typeResult.error);
    });
  }, [organisationId, creditNote]);

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
  const blocked = unsupported.length > 0 || !invoiceCurrency || currencyBlocked || !typeId || saving || !supplierReady;
  const linePage = gridPageSlice(lines, linePageIndex, linePageSize);
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
  const title = selectedPurchaseType?.description
    ? `Import ${selectedPurchaseType.description}`
    : documentTitle
      ? `Import ${documentTitle}`
      : "Import e-invoice";
  const statusText = unsupported.length
    ? `This e-invoice uses features Qula Plus cannot import yet: ${unsupported.join(", ")}`
    : typesReady && !typeId
      ? purchaseTypes.length === 0
        ? `Add a Purchases ${creditNote ? "credit note" : "invoice"} under Transaction types before importing.`
        : "Choose a Purchases document type."
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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    if (unsupported.length) {
      setError(`This e-invoice uses features Qula Plus cannot import yet: ${unsupported.join(", ")}`);
      return;
    }
    if (!typeId) {
      setError(purchaseTypes.length === 0
        ? `Add a Purchases ${creditNote ? "credit note" : "invoice"} under Transaction types before importing.`
        : "Choose a Purchases document type.");
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
    const typeColumn = creditNote ? "inbound_credit_note_type_id" : "inbound_invoice_type_id";
    await supabase.from("organisation_defaults").update({ [typeColumn]: typeId }).eq("organisation_id", organisationId);
    const { data, error: imported } = await supabase.rpc("import_e_document", {
      p_id: id,
      p_choices: {
        supplierId: effectiveSupplierId || null,
        transactionTypeId: typeId,
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
  }

  const split = useImportSplit();

  return {
    id,
    semantic,
    organisationId,
    documentNumber,
    creditNote,
    homeCurrencyId,
    canReject,
    suppliers,
    setSuppliers,
    rates,
    glCodes,
    departments,
    costCentres,
    currencies,
    units,
    supplierId,
    setSupplierId,
    purchaseTypes,
    typesReady,
    typeId,
    setTypeId,
    showCreate,
    setShowCreate,
    savePeppol,
    setSavePeppol,
    countries,
    schemes,
    code,
    setCode,
    name,
    setName,
    error,
    setError,
    saving,
    setSaving,
    headerTab,
    setHeaderTab,
    openLine,
    setOpenLine,
    lineMessage,
    linePageSize,
    setLinePageIndex,
    router,
    createSupplier,
    seller,
    sellerName,
    lineGridLines,
    lines,
    unsupported,
    endpoint,
    totals,
    nett,
    vat,
    gross,
    due,
    taxes,
    activeFlexLabels,
    grnIndex,
    otherRefIndex,
    showFlex,
    peppolMatch,
    vatMatch,
    matched,
    selected,
    invoiceCurrency,
    currencyBlocked,
    effectiveSupplierId,
    rateText,
    currencyLabel,
    homeCurrency,
    showHome,
    supplierReady,
    blocked,
    linePage,
    paymentCode,
    means,
    contact,
    title,
    statusText,
    choiceFor,
    close,
    changeLinePageSize,
    openEditor,
    saveLine,
    submit,
    ...split,
  };
}
