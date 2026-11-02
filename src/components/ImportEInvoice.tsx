"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EDocumentBody } from "@/components/EDocumentBody";
import FormModal from "@/components/FormModal";
import styles from "@/components/OpsPage.module.css";
import { sellerEndpoint, sellerIban, semanticAt, semanticRecord, semanticText } from "@/lib/einvoice/semantic-read";
import { clickOpensRow } from "@/lib/row-click";
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
type Vat = { id: string; code: string; vat_category: string | null; rate: number; vat_type: string };
type Named = { id: string; code: string; description: string };
type Currency = { id: string; code: string; iso_code: string | null };
type LineChoice = { vatRateId: string; glCodeId: string; departmentId: string; costCentreId: string };
type Memory = Record<string, { glCodeId: string; departmentId: string; costCentreId: string }>;

function sameId(left: string | null | undefined, right: string) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase());
}

export function ImportEInvoice({
  id,
  semantic,
  organisationId,
}: {
  id: string;
  semantic: Record<string, unknown> | null;
  organisationId: string;
}) {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [rates, setRates] = useState<Vat[]>([]);
  const [glCodes, setGlCodes] = useState<Named[]>([]);
  const [departments, setDepartments] = useState<Named[]>([]);
  const [costCentres, setCostCentres] = useState<Named[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [createSupplier, setCreateSupplier] = useState(false);
  const [code, setCode] = useState("");
  const seller = semanticRecord(semantic?.["BG-4"]);
  const sellerName = semanticText(seller?.["BT-27"]);
  const [name, setName] = useState(sellerName);
  const [choices, setChoices] = useState<Record<string, LineChoice>>({});
  const [loaded, setLoaded] = useState<{ supplierId: string; memory: Memory; previousIban: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lines = Array.isArray(semantic?.["BG-25"]) ? (semantic["BG-25"] as Record<string, unknown>[]) : [];
  const unsupported = Array.isArray(semantic?._unsupported) ? (semantic._unsupported as string[]) : [];
  const sellerVat = semanticText(seller?.["BT-31"]);
  const endpoint = sellerEndpoint(semantic);
  const currencyCode = semanticText(semantic?.["BT-5"]);
  const iban = sellerIban(semantic);
  const address = [
    semanticAt(seller, "BG-5", "BT-35"),
    semanticAt(seller, "BG-5", "BT-37"),
    semanticAt(seller, "BG-5", "BT-40"),
  ]
    .filter(Boolean)
    .join(", ");

  useEffect(() => {
    const supabase = createClient();
    void Promise.all([
      supabase.from("suppliers").select("id, name, code, vat_number, peppol_scheme, peppol_id, currency_id").eq("organisation_id", organisationId),
      supabase.from("vat_rates").select("id, code, vat_category, rate, vat_type").eq("organisation_id", organisationId).eq("vat_type", "Expense"),
      supabase.from("gl_codes").select("id, code, description").eq("organisation_id", organisationId).order("code"),
      supabase.from("departments").select("id, code, description").eq("organisation_id", organisationId).order("code"),
      supabase.from("cost_centres").select("id, code, description").eq("organisation_id", organisationId).order("code"),
      supabase.from("currencies").select("id, code, iso_code").eq("organisation_id", organisationId),
    ]).then(([supplierResult, vatResult, glResult, departmentResult, costResult, currencyResult]) => {
      setSuppliers((supplierResult.data ?? []) as Supplier[]);
      setRates((vatResult.data ?? []) as Vat[]);
      setGlCodes((glResult.data ?? []) as Named[]);
      setDepartments((departmentResult.data ?? []) as Named[]);
      setCostCentres((costResult.data ?? []) as Named[]);
      setCurrencies((currencyResult.data ?? []) as Currency[]);
    });
  }, [organisationId]);

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

  function choice(number: string, item: string): LineChoice {
    const category = semanticText(semanticRecord(lines.find((line) => String(line["BT-126"] ?? "") === number)?.["BG-30"])?.["BT-151"]);
    const rate = semanticText(semanticRecord(lines.find((line) => String(line["BT-126"] ?? "") === number)?.["BG-30"])?.["BT-152"]);
    const suggested = rates.find((entry) => entry.vat_category === category && Number(entry.rate) === Number(rate));
    const remembered = memory[item];
    return {
      vatRateId: choices[number]?.vatRateId || suggested?.id || "",
      glCodeId: choices[number]?.glCodeId || remembered?.glCodeId || "",
      departmentId: choices[number]?.departmentId || remembered?.departmentId || "",
      costCentreId: choices[number]?.costCentreId || remembered?.costCentreId || "",
    };
  }

  function setChoice(number: string, item: string, patch: Partial<LineChoice>) {
    setChoices((current) => ({ ...current, [number]: { ...choice(number, item), ...current[number], ...patch } }));
  }

  const ibanChanged = previousIban !== null && previousIban.replace(/\s/g, "") !== iban.replace(/\s/g, "");
  const [openLine, setOpenLine] = useState<OpenLine | null>(null);
  const [lineMessage, setLineMessage] = useState<string | null>(null);

  function openEditor(line: Record<string, unknown>) {
    const number = String(line["BT-126"] ?? "");
    const sellerItem = semanticAt(line, "BG-31", "BT-155");
    setLineMessage(null);
    setOpenLine({
      number,
      sellerItem,
      source: line,
      ...choice(number, sellerItem),
    });
  }

  function saveLine() {
    if (!openLine) return;
    if (!openLine.vatRateId) {
      setLineMessage("Choose a VAT code.");
      return;
    }
    setChoice(openLine.number, openLine.sellerItem, {
      vatRateId: openLine.vatRateId,
      glCodeId: openLine.glCodeId,
      departmentId: openLine.departmentId,
      costCentreId: openLine.costCentreId,
    });
    setOpenLine(null);
  }

  return (
    <>
    <form
      className={styles.documentFields}
      onSubmit={async (event) => {
        event.preventDefault();
        if (unsupported.length) {
          setError(`This e-invoice uses features FinTran cannot import yet: ${unsupported.join(", ")}`);
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
        const missingVat = lines.some((line) => {
          const number = String(line["BT-126"] ?? "");
          return !choice(number, semanticAt(line, "BG-31", "BT-155")).vatRateId;
        });
        if (missingVat) {
          setError("Choose a VAT code on every line.");
          return;
        }
        const supabase = createClient();
        const { data, error: imported } = await supabase.rpc("import_e_document", {
          p_id: id,
          p_choices: {
            supplierId: createSupplier ? null : effectiveSupplierId || null,
            createSupplier,
            supplier: { code, name: name || sellerName },
            lines: lines.map((line) => {
              const number = String(line["BT-126"] ?? "");
              const item = semanticAt(line, "BG-31", "BT-155");
              const selectedLine = choice(number, item);
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
      {unsupported.length ? (
        <p className={styles.alert}>This e-invoice uses features FinTran cannot import yet: {unsupported.join(", ")}</p>
      ) : null}
      {ibanChanged ? (
        <p className={styles.alert}>
          This IBAN differs from the account on the last imported e-invoice from this supplier
          {previousIban ? ` (${previousIban})` : ""}.
        </p>
      ) : null}
      {!invoiceCurrency ? <p className={styles.alert}>Add the invoice currency {currencyCode || ""} to this organisation before importing.</p> : null}
      {currencyBlocked ? <p className={styles.alert}>The supplier currency must match the e-invoice currency.</p> : null}
      <div className={`${styles.invoiceSplit} ${styles.importSplit}`}>
      <div className={styles.headerPane}>
      <div className={styles.paneLabel}>Header</div>
      <div className={styles.headerBody}>
      <EDocumentBody semantic={semantic} hideLines embedded />
      <p className={styles.panelMeta}>
        {peppolMatch
          ? `Matched supplier ${peppolMatch.code} ${peppolMatch.name} by Peppol ID.`
          : matched
            ? `Matched supplier ${matched.code} ${matched.name} by VAT number.`
            : "No supplier matched. Create one or choose an existing supplier."}
      </p>
      <div className={`${styles.invoiceForm} ${styles.headerFields}`}>
        {createSupplier ? (
          <label className={styles.field}>
            Supplier code
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required maxLength={20} className={styles.mono} />
          </label>
        ) : (
          <label className={styles.field}>
            Supplier code
            <select value={supplierId || matched?.id || ""} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Choose a supplier</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.code} — {supplier.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.field}>
          Supplier name
          <input
            value={createSupplier ? name : selected?.name || sellerName}
            readOnly={!createSupplier}
            required={createSupplier}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Currency
          <input readOnly value={currencyCode} className={styles.mono} />
        </label>
        <label className={styles.checkLine}>
          <input type="checkbox" checked={createSupplier} onChange={(event) => setCreateSupplier(event.target.checked)} />
          Create supplier
        </label>
        <p className={`${styles.panelMeta} ${styles.wide}`}>
          {address ? `${address}. ` : ""}
          {sellerVat ? `VAT ${sellerVat}. ` : ""}
          {endpoint.id ? `Peppol ${endpoint.scheme}:${endpoint.id}. ` : ""}
          {iban ? `IBAN ${iban} is shown for checking and is not saved. ` : ""}
          {createSupplier ? "The address, VAT number, Peppol ID, and invoice currency are copied when you import." : ""}
        </p>
      </div>
      </div>
      </div>
      <div className={styles.splitHandle} aria-hidden="true" />
      <div className={styles.linesPane}>
      <div className={styles.gridToolbar}>
        <span className={styles.paneLabel}>
          Lines ({lines.length})
          <span className={styles.lineHint}>Select a line to set its VAT, GL, department, and cost centre.</span>
        </span>
      </div>
      <div className={styles.importLines}>
        <table className={styles.lineTable}>
          <thead>
            <tr>
              <th>Line</th>
              <th>Description</th>
              <th className={styles.num}>Qty</th>
              <th className={styles.num}>Price</th>
              <th>GL</th>
              <th>VAT</th>
              <th>Department</th>
              <th>Cost centre</th>
              <th className={styles.actions}>&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr>
                <td colSpan={9}>No lines.</td>
              </tr>
            ) : (
              lines.map((line) => {
                const number = String(line["BT-126"] ?? "");
                const item = semanticRecord(line["BG-31"]);
                const sellerItem = semanticText(item?.["BT-155"]);
                const selectedLine = choice(number, sellerItem);
                return (
                  <tr key={number} className={styles.lineClick} onClick={(event) => { if (clickOpensRow(event.target)) openEditor(line); }}>
                    <td className={styles.mono}>{number}</td>
                    <td>{semanticText(item?.["BT-154"]) || semanticText(item?.["BT-153"]) || "Item"}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{semanticText(line["BT-129"]) || "—"}</td>
                    <td className={`${styles.mono} ${styles.num}`}>{semanticAt(line, "BG-29", "BT-146") || "—"}</td>
                    <td className={styles.mono}>{namedCode(glCodes, selectedLine.glCodeId)}</td>
                    <td className={styles.mono}>{vatCode(rates, selectedLine.vatRateId)}</td>
                    <td className={styles.mono}>{namedCode(departments, selectedLine.departmentId)}</td>
                    <td className={styles.mono}>{namedCode(costCentres, selectedLine.costCentreId)}</td>
                    <td className={styles.actions}>
                      <button className={styles.quiet} type="button" onClick={() => openEditor(line)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      </div>
      </div>
      {error ? <p className={styles.alert}>{error}</p> : null}
      <div className={styles.modalActions}>
        <button className={styles.primary} type="submit" disabled={unsupported.length > 0 || !invoiceCurrency || currencyBlocked}>
          Import as draft
        </button>
      </div>
    </form>
    {openLine ? (
      <LineCoding
        line={openLine}
        message={lineMessage}
        rates={rates}
        glCodes={glCodes}
        departments={departments}
        costCentres={costCentres}
        onChange={setOpenLine}
        onCancel={() => setOpenLine(null)}
        onSave={saveLine}
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

function lineFacts(line: Record<string, unknown>) {
  const item = semanticRecord(line["BG-31"]);
  const tax = semanticRecord(line["BG-30"]);
  const price = semanticRecord(line["BG-29"]);
  const facts = [
    { label: "Item name", value: semanticText(item?.["BT-153"]), wide: true },
    { label: "Description", value: semanticText(item?.["BT-154"]), wide: true },
    { label: "Seller's item", value: semanticText(item?.["BT-155"]) },
    { label: "Note", value: semanticText(line["BT-127"]), wide: true },
    { label: "Quantity", value: semanticText(line["BT-129"]) },
    { label: "Unit", value: semanticText(line["BT-130"]) },
    { label: "Price", value: semanticText(price?.["BT-146"]) },
    { label: "Base quantity", value: semanticText(price?.["BT-149"]) },
    { label: "Line amount", value: semanticText(line["BT-131"]) },
    { label: "VAT category", value: semanticText(tax?.["BT-151"]) },
    { label: "VAT rate", value: semanticText(tax?.["BT-152"]) },
  ];
  const allowances = Array.isArray(line["BG-27"]) ? line["BG-27"] : [];
  allowances.forEach((entry, index) => {
    const allowance = semanticRecord(entry);
    facts.push(
      { label: `Allowance ${index + 1}`, value: semanticText(allowance?.["BT-136"]), wide: false },
      { label: `Allowance reason ${index + 1}`, value: semanticText(allowance?.["BT-140"]), wide: false },
    );
  });
  return facts;
}

function namedCode(rows: Named[], id: string) {
  return rows.find((row) => row.id === id)?.code || "—";
}

function vatCode(rows: Vat[], id: string) {
  return rows.find((row) => row.id === id)?.code || "—";
}

function LineCoding({
  line,
  message,
  rates,
  glCodes,
  departments,
  costCentres,
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
  onChange: (line: OpenLine) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
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
        {lineFacts(line.source).map((fact) => (
          <label key={fact.label} className={fact.wide ? `${styles.field} ${styles.wide}` : styles.field}>
            {fact.label}
            <input readOnly value={fact.value} className={styles.mono} />
          </label>
        ))}
        <p className={`${styles.sectionLabel} ${styles.wide}`}>For this organisation</p>
        <label className={styles.field}>
          VAT code
          <select autoComplete="off" value={line.vatRateId} onChange={(event) => onChange({ ...line, vatRateId: event.target.value })}>
            <option value="">Choose a VAT code</option>
            {rates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} — {entry.vat_category} {entry.rate}%
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          GL code
          <select autoComplete="off" value={line.glCodeId} onChange={(event) => onChange({ ...line, glCodeId: event.target.value })}>
            <option value="">No GL code</option>
            {glCodes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.code} — {entry.description}
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
                {entry.code} — {entry.description}
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
                {entry.code} — {entry.description}
              </option>
            ))}
          </select>
        </label>
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
