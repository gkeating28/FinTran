"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "@/components/OpsPage.module.css";
import { sellerEndpoint, sellerIban, semanticAt, semanticRecord, semanticText } from "@/lib/einvoice/semantic-read";
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
  const [name, setName] = useState("");
  const [choices, setChoices] = useState<Record<string, LineChoice>>({});
  const [memory, setMemory] = useState<Memory>({});
  const [previousIban, setPreviousIban] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lines = Array.isArray(semantic?.["BG-25"]) ? (semantic["BG-25"] as Record<string, unknown>[]) : [];
  const unsupported = Array.isArray(semantic?._unsupported) ? (semantic._unsupported as string[]) : [];
  const seller = semanticRecord(semantic?.["BG-4"]);
  const sellerVat = semanticText(seller?.["BT-31"]);
  const endpoint = sellerEndpoint(semantic);
  const sellerName = semanticText(seller?.["BT-27"]);
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

  useEffect(() => {
    setName(sellerName);
  }, [sellerName]);

  useEffect(() => {
    if (!effectiveSupplierId) {
      setMemory({});
      setPreviousIban(null);
      return;
    }
    const supabase = createClient();
    void supabase
      .from("transaction_headers")
      .select("id, created_at")
      .eq("organisation_id", organisationId)
      .eq("supplier_id", effectiveSupplierId)
      .then(async ({ data }) => {
        const headers = (data ?? []) as { id: string; created_at: string }[];
        const headerIds = headers.map((row) => row.id);
        if (headerIds.length === 0) {
          setMemory({});
          setPreviousIban(null);
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
        const imported = (documentResult.data ?? []) as { semantic?: unknown; header_id: string; created_at: string }[];
        const importedIds = imported.map((row) => row.header_id);
        const newestFirst = new Map(imported.map((row, index) => [row.header_id, index]));
        const lineResult = importedIds.length
          ? await supabase
              .from("transaction_lines")
              .select("seller_item_id, gl_code_id, department_id, cost_centre_id, header_id")
              .in("header_id", importedIds)
          : { data: [] };
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
        setMemory(next);
        const previous = imported[0];
        setPreviousIban(previous ? sellerIban(previous.semantic) : null);
      });
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

  return (
    <form
      className={styles.stack}
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
      <h2 className={styles.heading}>Import</h2>
      {unsupported.length ? (
        <p className={styles.alert}>This e-invoice uses features FinTran cannot import yet: {unsupported.join(", ")}</p>
      ) : null}
      <p className={styles.panelMeta}>
        {peppolMatch
          ? `Matched supplier ${peppolMatch.code} ${peppolMatch.name} by Peppol ID.`
          : matched
            ? `Matched supplier ${matched.code} ${matched.name} by VAT number.`
            : "No supplier matched. Create one or choose an existing supplier."}
      </p>
      <p className={styles.panelMeta}>
        Seller {sellerName || "—"}
        {sellerVat ? ` · VAT ${sellerVat}` : ""}
        {endpoint.id ? ` · Peppol ${endpoint.scheme}:${endpoint.id}` : ""}
        {address ? ` · ${address}` : ""}
        {currencyCode ? ` · ${currencyCode}` : ""}
      </p>
      {iban ? <p className={styles.panelMeta}>Seller IBAN {iban}. This account is shown for checking and is not saved on the supplier.</p> : null}
      {ibanChanged ? (
        <p className={styles.alert}>
          This IBAN differs from the account on the last imported e-invoice from this supplier
          {previousIban ? ` (${previousIban})` : ""}.
        </p>
      ) : null}
      {!invoiceCurrency ? <p className={styles.alert}>Add the invoice currency {currencyCode || ""} to this organisation before importing.</p> : null}
      {currencyBlocked ? <p className={styles.alert}>The supplier currency must match the e-invoice currency.</p> : null}
      <label className={styles.field}>
        Supplier
        <select value={supplierId || matched?.id || ""} onChange={(event) => setSupplierId(event.target.value)} disabled={createSupplier}>
          <option value="">Choose</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.code} {supplier.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <input type="checkbox" checked={createSupplier} onChange={(event) => setCreateSupplier(event.target.checked)} /> Create supplier
      </label>
      {createSupplier ? (
        <>
          <label className={styles.field}>
            Supplier code
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required maxLength={20} />
          </label>
          <label className={styles.field}>
            Supplier name
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={200} />
          </label>
          <p className={styles.panelMeta}>The address, VAT number, Peppol ID, and invoice currency are copied from the e-invoice when you confirm.</p>
        </>
      ) : null}
      {lines.map((line) => {
        const number = String(line["BT-126"] ?? "");
        const item = semanticRecord(line["BG-31"]);
        const sellerItem = semanticText(item?.["BT-155"]);
        const category = semanticText(semanticRecord(line["BG-30"])?.["BT-151"]);
        const rate = semanticText(semanticRecord(line["BG-30"])?.["BT-152"]);
        const selectedLine = choice(number, sellerItem);
        return (
          <div key={number} className={styles.stack}>
            <p className={styles.panelMeta}>
              Line {number}: {semanticText(item?.["BT-153"]) || "Item"}
              {sellerItem ? ` · item ${sellerItem}` : ""} · qty {semanticText(line["BT-129"])} · price {semanticAt(line, "BG-29", "BT-146")}
            </p>
            <label className={styles.field}>
              VAT ({category} {rate})
              <select value={selectedLine.vatRateId} onChange={(event) => setChoice(number, sellerItem, { vatRateId: event.target.value })} required>
                <option value="">Choose</option>
                {rates.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code} {entry.vat_category} {entry.rate}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              GL code
              <select value={selectedLine.glCodeId} onChange={(event) => setChoice(number, sellerItem, { glCodeId: event.target.value })}>
                <option value="">None</option>
                {glCodes.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code} {entry.description}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Department
              <select value={selectedLine.departmentId} onChange={(event) => setChoice(number, sellerItem, { departmentId: event.target.value })}>
                <option value="">None</option>
                {departments.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code} {entry.description}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              Cost centre
              <select value={selectedLine.costCentreId} onChange={(event) => setChoice(number, sellerItem, { costCentreId: event.target.value })}>
                <option value="">None</option>
                {costCentres.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.code} {entry.description}
                  </option>
                ))}
              </select>
            </label>
          </div>
        );
      })}
      <button className={styles.primary} type="submit" disabled={unsupported.length > 0 || !invoiceCurrency || currencyBlocked}>
        Import as draft
      </button>
      {error ? <p className={styles.alert}>{error}</p> : null}
    </form>
  );
}
