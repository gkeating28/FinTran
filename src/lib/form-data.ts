import { formatPostalAddress } from "@/lib/address";
import { getWorkspace } from "@/lib/data";
import {
  buildPrintView,
  emptyOrganisation,
  sampleSource,
  type FormLine,
  type FormOrganisation,
  type FormSource,
  type PrintView,
} from "@/lib/form-document";
import {
  defaultLayout,
  documentNumberLabel,
  parseLayout,
  type FormLayout,
} from "@/lib/form-layout";
import { formatInteger } from "@/lib/numbers";
import { organisationLogoUrl, organisationObjectUrl } from "@/lib/organisation-logo";
import { listTransactionMenu, type TransactionMenuTile } from "@/lib/transaction-type-data";
import { parseTransactionTypeKind, type TransactionTypeKind } from "@/lib/transaction-types";
import { createClient } from "@/lib/supabase/server";

const HEADER_SELECT = `
  id, status, reference, transaction_date, due_date, supplier_name, contact_details,
  exchange_rate, order_number, supplier_reference, supply_date, foreign_nett_amount, foreign_vat_amount, foreign_total_amount, paid_amount,
  flex1, flex2, flex3, flex4, flex5, issuer_snapshot, party_snapshot,
  currencies(code),
  suppliers(code, name, phone, email, website, address_line1, address_line2, address_line3, city, post_code, county, country_code, contact_details, vat_number, ref_countries(name)),
  transaction_lines(
    line_number, description, quantity, price, discount_amount, nett_amount, vat_amount, vat_percentage,
    products(code, description),
    gl_codes(code),
    departments(code),
    cost_centres(code),
    vat_rates(code, description, rate)
  )
`;

export type FormType = {
  id: string;
  code: string;
  description: string;
  kind: TransactionTypeKind;
  flexLabels: [string, string, string, string, string];
};

export type FormMenuTile = TransactionMenuTile & {
  custom: boolean;
};

type Loose = Record<string, unknown>;

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function amount(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function flexLabels(row: Loose): [string, string, string, string, string] {
  return [1, 2, 3, 4, 5].map((index) => text(row[`flex${index}_label`])) as [
    string,
    string,
    string,
    string,
    string,
  ];
}

async function organisationDetails(organisationId: string, organisationName: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("organisation_defaults")
    .select(
      "address_line1, address_line2, address_line3, city, post_code, county, country_code, ref_countries(name), contact_name, contact_email, website, phone, vat_number, company_number, banking_details, logo_path, updated_at, currencies(code)",
    )
    .eq("organisation_id", organisationId)
    .maybeSingle();

  const row = (data ?? {}) as Loose;
  const currency = one(row.currencies as { code?: string } | { code?: string }[] | null);
  const country = one(row.ref_countries as { name?: string } | { name?: string }[] | null);
  const organisation: FormOrganisation = {
    ...emptyOrganisation(),
    name: organisationName,
    address: formatPostalAddress({
      line1: text(row.address_line1),
      line2: text(row.address_line2),
      line3: text(row.address_line3),
      city: text(row.city),
      county: text(row.county),
      postCode: text(row.post_code),
      countryName: text(country?.name) || text(row.country_code),
    }),
    phone: text(row.phone),
    contactName: text(row.contact_name),
    contactEmail: text(row.contact_email),
    website: text(row.website),
    vatNumber: text(row.vat_number),
    companyNumber: text(row.company_number),
    bankingDetails: text(row.banking_details),
    logoUrl: row.logo_path ? organisationLogoUrl(organisationId, text(row.updated_at)) : null,
  };
  return { organisation, currencyCode: text(currency?.code) };
}

function snapshotText(snapshot: Loose | null, key: string) {
  return text(snapshot?.[key]);
}

function organisationFromSnapshot(snapshot: Loose, organisationId: string): FormOrganisation {
  const logoPath = snapshotText(snapshot, "logoPath");
  return {
    ...emptyOrganisation(),
    name: snapshotText(snapshot, "name"),
    address: snapshotText(snapshot, "address"),
    phone: snapshotText(snapshot, "phone"),
    contactName: snapshotText(snapshot, "contactName"),
    contactEmail: snapshotText(snapshot, "contactEmail"),
    website: snapshotText(snapshot, "website"),
    vatNumber: snapshotText(snapshot, "vatNumber"),
    companyNumber: snapshotText(snapshot, "companyNumber"),
    bankingDetails: snapshotText(snapshot, "bankingDetails"),
    logoUrl: logoPath ? organisationObjectUrl(organisationId, logoPath, logoPath) : null,
  };
}

function sourceFromHeader(row: Loose, type: FormType, organisation: FormOrganisation, organisationId: string): FormSource {
  const status = text(row.status);
  const frozen = status === "posted" || status === "void";
  const issuer = frozen && row.issuer_snapshot && typeof row.issuer_snapshot === "object"
    ? (row.issuer_snapshot as Loose)
    : null;
  const partySnapshot = frozen && row.party_snapshot && typeof row.party_snapshot === "object"
    ? (row.party_snapshot as Loose)
    : null;
  const supplier = one(row.suppliers as Loose | Loose[] | null);
  const currency = one(row.currencies as { code?: string } | { code?: string }[] | null);
  const rawLines = row.transaction_lines;
  const lineRows = (Array.isArray(rawLines) ? rawLines : rawLines ? [rawLines] : []) as Loose[];
  lineRows.sort((left, right) => amount(left.line_number) - amount(right.line_number));

  const lines: FormLine[] = lineRows.map((line) => {
    const product = one(line.products as Loose | Loose[] | null);
    const gl = one(line.gl_codes as Loose | Loose[] | null);
    const department = one(line.departments as Loose | Loose[] | null);
    const centre = one(line.cost_centres as Loose | Loose[] | null);
    const vat = one(line.vat_rates as Loose | Loose[] | null);
    const storedRate = line.vat_percentage == null || line.vat_percentage === "" ? null : amount(line.vat_percentage);
    const liveRate = vat?.rate == null || vat.rate === "" ? null : amount(vat.rate);
    const rate = frozen ? storedRate : liveRate;
    return {
      item: text(product?.description) || text(product?.code),
      description: text(line.description),
      tax: text(vat?.description) || text(vat?.code),
      taxRate: rate,
      quantity: amount(line.quantity),
      price: amount(line.price),
      discount: amount(line.discount_amount),
      nett: amount(line.nett_amount),
      vat: amount(line.vat_amount),
      glCode: text(gl?.code),
      vatCode: text(vat?.code),
      department: text(department?.code),
      costCentre: text(centre?.code),
    };
  });

  const printedOrganisation = issuer ? organisationFromSnapshot(issuer, organisationId) : organisation;
  return {
    organisation: printedOrganisation,
    party: partySnapshot
      ? {
          code: snapshotText(partySnapshot, "code"),
          name: snapshotText(partySnapshot, "name"),
          address: snapshotText(partySnapshot, "address"),
          contactDetails: snapshotText(partySnapshot, "contactDetails"),
          phone: snapshotText(partySnapshot, "phone"),
          email: snapshotText(partySnapshot, "email"),
          website: snapshotText(partySnapshot, "website"),
        }
      : {
          code: text(supplier?.code),
          name: text(row.supplier_name) || text(supplier?.name),
          address: formatPostalAddress({
            line1: text(supplier?.address_line1),
            line2: text(supplier?.address_line2),
            line3: text(supplier?.address_line3),
            city: text(supplier?.city),
            county: text(supplier?.county),
            postCode: text(supplier?.post_code),
            countryName: text(one(supplier?.ref_countries as { name?: string } | { name?: string }[] | null)?.name) || text(supplier?.country_code),
          }),
          contactDetails: text(row.contact_details) || text(supplier?.contact_details),
          phone: text(supplier?.phone),
          email: text(supplier?.email),
          website: text(supplier?.website),
        },
    header: {
      reference: text(row.reference) ? formatInteger(text(row.reference)) : "Draft",
      transactionDate: text(row.transaction_date),
      dueDate: text(row.due_date),
      orderNumber: text(row.order_number),
      currencyCode: text(currency?.code),
      exchangeRate: text(row.exchange_rate),
      paidAmount: amount(row.paid_amount),
      supplierReference: text(row.supplier_reference),
      supplyDate: text(row.supply_date),
      flex: [1, 2, 3, 4, 5].map((index) => text(row[`flex${index}`])) as FormSource["header"]["flex"],
      foreignNett: amount(row.foreign_nett_amount),
      foreignVat: amount(row.foreign_vat_amount),
      foreignTotal: amount(row.foreign_total_amount),
    },
    lines,
    flexLabels: type.flexLabels,
    numberLabel: documentNumberLabel(type.code, type.description),
    watermark: status === "void" ? "VOID" : status === "posted" ? null : row.id ? "DRAFT" : null,
  };
}

export async function getFormType(code: string): Promise<{ type: FormType | null; error: string | null }> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { type: null, error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_types")
    .select("id, code, description, type, flex1_label, flex2_label, flex3_label, flex4_label, flex5_label")
    .eq("organisation_id", workspace.current.organisationId)
    .eq("code", code.trim().toUpperCase())
    .maybeSingle();

  if (error) return { type: null, error: "That form could not be loaded." };
  const kind = data ? parseTransactionTypeKind(data.type) : null;
  if (!data || !kind) return { type: null, error: null };

  return {
    type: {
      id: data.id,
      code: data.code,
      description: data.description,
      kind,
      flexLabels: flexLabels(data),
    },
    error: null,
  };
}

export async function listFormMenu(): Promise<{ tiles: FormMenuTile[]; error: string | null }> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { tiles: [], error: null };
  const menu = await listTransactionMenu();
  if (menu.error) return { tiles: [], error: menu.error };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_forms")
    .select("transaction_type_id")
    .eq("organisation_id", workspace.current.organisationId);
  if (error) return { tiles: [], error: "Forms could not be loaded." };

  const custom = new Set((data ?? []).map((row) => row.transaction_type_id));
  return {
    tiles: menu.tiles.map((tile) => ({ ...tile, custom: custom.has(tile.id) })),
    error: null,
  };
}

async function savedLayout(organisationId: string, type: FormType) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transaction_forms")
    .select("layout")
    .eq("organisation_id", organisationId)
    .eq("transaction_type_id", type.id)
    .maybeSingle();
  if (error) return { layout: defaultLayout(type.kind, type.description), custom: false, error: "The form layout could not be loaded." };
  if (!data) return { layout: defaultLayout(type.kind, type.description), custom: false, error: null };
  return { layout: parseLayout(data.layout, type.kind, type.description), custom: true, error: null };
}

export async function loadFormDesigner(code: string): Promise<{
  type: FormType | null;
  layout: FormLayout;
  source: FormSource | null;
  sample: boolean;
  custom: boolean;
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") {
    return { type: null, layout: defaultLayout("Purchases", "Document"), source: null, sample: true, custom: false, error: null };
  }
  const loaded = await getFormType(code);
  if (loaded.error || !loaded.type) {
    return {
      type: null,
      layout: defaultLayout("Purchases", "Document"),
      source: null,
      sample: true,
      custom: false,
      error: loaded.error,
    };
  }

  const type = loaded.type;
  const [stored, details] = await Promise.all([
    savedLayout(workspace.current.organisationId, type),
    organisationDetails(workspace.current.organisationId, workspace.current.organisationName),
  ]);

  const supabase = await createClient();
  const latest = await supabase
    .from("transaction_headers")
    .select(HEADER_SELECT)
    .eq("organisation_id", workspace.current.organisationId)
    .eq("transaction_type_id", type.id)
    .order("transaction_date", { ascending: false })
    .order("reference", { ascending: false })
    .limit(1)
    .maybeSingle();

  const source = latest.data
    ? sourceFromHeader(latest.data as unknown as Loose, type, details.organisation, workspace.current.organisationId)
    : sampleSource(details.organisation, details.currencyCode);
  source.numberLabel = documentNumberLabel(type.code, type.description);
  source.flexLabels = type.flexLabels;

  return {
    type,
    layout: stored.layout,
    source,
    sample: !latest.data,
    custom: stored.custom,
    error: stored.error,
  };
}

export async function loadPrintedDocument(code: string, id: string): Promise<{
  view: PrintView | null;
  type: FormType | null;
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { view: null, type: null, error: null };
  const loaded = await getFormType(code);
  if (loaded.error || !loaded.type) return { view: null, type: loaded.type, error: loaded.error };

  const supabase = await createClient();
  const [header, stored, details] = await Promise.all([
    supabase
      .from("transaction_headers")
      .select(HEADER_SELECT)
      .eq("id", id)
      .eq("organisation_id", workspace.current.organisationId)
      .eq("transaction_type_id", loaded.type.id)
      .maybeSingle(),
    savedLayout(workspace.current.organisationId, loaded.type),
    organisationDetails(workspace.current.organisationId, workspace.current.organisationName),
  ]);

  if (header.error || stored.error) return { view: null, type: loaded.type, error: "That document could not be printed." };
  if (!header.data) return { view: null, type: loaded.type, error: null };

  return {
    view: buildPrintView(
      stored.layout,
      sourceFromHeader(header.data as unknown as Loose, loaded.type, details.organisation, workspace.current.organisationId),
    ),
    type: loaded.type,
    error: null,
  };
}
