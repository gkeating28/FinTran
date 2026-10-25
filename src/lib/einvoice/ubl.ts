import { XMLParser } from "fast-xml-parser";
import { rejectUnsafeXml, UBL, xmlEscape } from "./xml";

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
type RecordJson = { [key: string]: Json };

function text(value: Json | undefined) {
  return typeof value === "string" && value !== "" ? value : null;
}

function object(value: Json | undefined): RecordJson | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function list(value: Json | undefined): RecordJson[] {
  if (Array.isArray(value)) return value.filter((item): item is RecordJson => !!object(item));
  const one = object(value);
  return one ? [one] : [];
}

function amount(currency: string, value: string | null, name: string) {
  if (!value) return "";
  return `<cbc:${name} currencyID="${xmlEscape(currency)}">${xmlEscape(value)}</cbc:${name}>`;
}

function element(name: string, value: string | null) {
  if (!value) return "";
  return `<cbc:${name}>${xmlEscape(value)}</cbc:${name}>`;
}

function address(value: RecordJson | null) {
  if (!value) return "";
  const line3 = text(value["BT-162"]);
  return `<cac:PostalAddress>${element("StreetName", text(value["BT-35"]))}${element("AdditionalStreetName", text(value["BT-36"]))}${
    line3 ? `<cac:AddressLine>${element("Line", line3)}</cac:AddressLine>` : ""
  }${element("CityName", text(value["BT-37"]))}${element("PostalZone", text(value["BT-38"]))}${element("CountrySubentity", text(value["BT-39"]))}${
    text(value["BT-40"])
      ? `<cac:Country>${element("IdentificationCode", text(value["BT-40"]))}</cac:Country>`
      : ""
  }</cac:PostalAddress>`;
}

function party(value: RecordJson | null, contactName: string, contactPhone: string, contactEmail: string) {
  if (!value) return "";
  const endpoint = object(value["BT-34"] ?? value["BT-49"]);
  const contact = object(value["BG-6"] ?? value["BG-9"]);
  const nameKey = text(value["BT-27"]) ? "BT-27" : "BT-44";
  const idKey = text(value["BT-29"]) ? "BT-29" : text(value["BT-46"]) ? "BT-46" : null;
  const companyKey = text(value["BT-30"]) ? "BT-30" : text(value["BT-47"]) ? "BT-47" : null;
  const vatKey = text(value["BT-31"]) ? "BT-31" : text(value["BT-48"]) ? "BT-48" : null;
  const addressNode = object(value["BG-5"] ?? value["BG-8"]);
  return `<cac:Party>${
    endpoint ? `<cbc:EndpointID schemeID="${xmlEscape(text(endpoint.scheme) ?? "")}">${xmlEscape(text(endpoint.value) ?? "")}</cbc:EndpointID>` : ""
  }${idKey ? `<cac:PartyIdentification>${element("ID", text(value[idKey]))}</cac:PartyIdentification>` : ""}${address(addressNode)}${
    vatKey
      ? `<cac:PartyTaxScheme>${element("CompanyID", text(value[vatKey]))}<cac:TaxScheme>${element("ID", "VAT")}</cac:TaxScheme></cac:PartyTaxScheme>`
      : ""
  }<cac:PartyLegalEntity>${element("RegistrationName", text(value[nameKey]))}${element("CompanyID", companyKey ? text(value[companyKey]) : null)}</cac:PartyLegalEntity>${
    contact
      ? `<cac:Contact>${element("Name", text(contact[contactName]))}${element("Telephone", text(contact[contactPhone]))}${element("ElectronicMail", text(contact[contactEmail]))}</cac:Contact>`
      : ""
  }</cac:Party>`;
}

function taxSubtotal(currency: string, row: RecordJson) {
  return `<cac:TaxSubtotal>${amount(currency, text(row["BT-116"]), "TaxableAmount")}${amount(currency, text(row["BT-117"]), "TaxAmount")}<cac:TaxCategory>${element("ID", text(row["BT-118"]))}${element("Percent", text(row["BT-119"]))}${element("TaxExemptionReasonCode", text(row["BT-121"]))}${element("TaxExemptionReason", text(row["BT-120"]))}<cac:TaxScheme>${element("ID", "VAT")}</cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
}

function line(currency: string, row: RecordJson, credit: boolean) {
  const quantity = text(row["BT-129"]);
  const unit = text(row["BT-130"]);
  const item = object(row["BG-31"]);
  const tax = object(row["BG-30"]);
  const price = object(row["BG-29"]);
  const allowances = list(row["BG-27"])
    .map(
      (allowance) =>
        `<cac:AllowanceCharge>${element("ChargeIndicator", "false")}${element("AllowanceChargeReasonCode", text(allowance["BT-140"]))}${amount(currency, text(allowance["BT-136"]), "Amount")}</cac:AllowanceCharge>`,
    )
    .join("");
  return `<cac:${credit ? "CreditNoteLine" : "InvoiceLine"}>${element("ID", text(row["BT-126"]))}${element("Note", text(row["BT-127"]))}${
    quantity
      ? `<cbc:${credit ? "CreditedQuantity" : "InvoicedQuantity"}${unit ? ` unitCode="${xmlEscape(unit)}"` : ""}>${xmlEscape(quantity)}</cbc:${credit ? "CreditedQuantity" : "InvoicedQuantity"}>`
      : ""
  }${amount(currency, text(row["BT-131"]), "LineExtensionAmount")}${allowances}<cac:Item>${element("Description", text(row["BT-154"]))}${element("Name", text(item?.["BT-153"] ?? null))}${
    text(item?.["BT-155"] ?? null)
      ? `<cac:SellersItemIdentification>${element("ID", text(item?.["BT-155"] ?? null))}</cac:SellersItemIdentification>`
      : ""
  }${
    tax
      ? `<cac:ClassifiedTaxCategory>${element("ID", text(tax["BT-151"]))}${element("Percent", text(tax["BT-152"]))}<cac:TaxScheme>${element("ID", "VAT")}</cac:TaxScheme></cac:ClassifiedTaxCategory>`
      : ""
  }</cac:Item><cac:Price>${amount(currency, text(price?.["BT-146"] ?? null), "PriceAmount")}${element("BaseQuantity", text(price?.["BT-149"] ?? null))}</cac:Price></cac:${credit ? "CreditNoteLine" : "InvoiceLine"}>`;
}

export function generateUbl(semantic: RecordJson) {
  const credit = text(semantic["BT-3"]) === "381";
  const currency = text(semantic["BT-5"]) ?? "EUR";
  const root = credit ? "CreditNote" : "Invoice";
  const namespace = credit ? UBL.creditNote : UBL.invoice;
  const seller = object(semantic["BG-4"]);
  const buyer = object(semantic["BG-7"]);
  const payment = object(semantic["BG-16"]);
  const account = object(payment?.["BG-17"] ?? null);
  const totals = object(semantic["BG-22"]);
  const period = object(semantic["BG-14"]);
  const preceding = object(semantic["BG-3"]);
  const due = text(semantic["BT-9"]);
  const accounting = text(semantic["BT-6"]);
  const paymentMeans = payment
    ? `<cac:PaymentMeans>${element("PaymentMeansCode", text(payment["BT-81"]))}${
        credit ? element("PaymentDueDate", due) : ""
      }${element("PaymentID", text(payment["BT-83"]))}${
        account
          ? `<cac:PayeeFinancialAccount>${element("ID", text(account["BT-84"]))}${element("Name", text(account["BT-85"]))}${
              text(account["BT-86"])
                ? `<cac:FinancialInstitutionBranch>${element("ID", text(account["BT-86"]))}</cac:FinancialInstitutionBranch>`
                : ""
            }</cac:PayeeFinancialAccount>`
          : ""
      }</cac:PaymentMeans>`
    : credit && due
      ? `<cac:PaymentMeans>${element("PaymentDueDate", due)}</cac:PaymentMeans>`
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<${root} xmlns="${namespace}" xmlns:cac="${UBL.cac}" xmlns:cbc="${UBL.cbc}">` +
    element("CustomizationID", text(semantic["BT-24"])) +
    element("ProfileID", text(semantic["BT-23"])) +
    element("ID", text(semantic["BT-1"])) +
    element("IssueDate", text(semantic["BT-2"])) +
    (credit ? "" : element("DueDate", due)) +
    element(credit ? "CreditNoteTypeCode" : "InvoiceTypeCode", text(semantic["BT-3"])) +
    element("Note", text(semantic["BT-22"])) +
    element("DocumentCurrencyCode", currency) +
    element("TaxCurrencyCode", accounting) +
    element("BuyerReference", text(semantic["BT-10"])) +
    (period
      ? `<cac:InvoicePeriod>${element("StartDate", text(period["BT-73"]))}${element("EndDate", text(period["BT-74"]))}</cac:InvoicePeriod>`
      : "") +
    (text(semantic["BT-13"]) ? `<cac:OrderReference>${element("ID", text(semantic["BT-13"]))}</cac:OrderReference>` : "") +
    (preceding
      ? `<cac:BillingReference><cac:InvoiceDocumentReference>${element("ID", text(preceding["BT-25"]))}${element("IssueDate", text(preceding["BT-26"]))}</cac:InvoiceDocumentReference></cac:BillingReference>`
      : "") +
    (text(semantic["BT-12"]) ? `<cac:ContractDocumentReference>${element("ID", text(semantic["BT-12"]))}</cac:ContractDocumentReference>` : "") +
    (seller ? `<cac:AccountingSupplierParty>${party(seller, "BT-41", "BT-42", "BT-43")}</cac:AccountingSupplierParty>` : "") +
    (buyer ? `<cac:AccountingCustomerParty>${party(buyer, "BT-56", "BT-57", "BT-58")}</cac:AccountingCustomerParty>` : "") +
    (text(semantic["BT-72"]) ? `<cac:Delivery>${element("ActualDeliveryDate", text(semantic["BT-72"]))}</cac:Delivery>` : "") +
    paymentMeans +
    (text(semantic["BT-20"]) ? `<cac:PaymentTerms>${element("Note", text(semantic["BT-20"]))}</cac:PaymentTerms>` : "") +
    (totals
      ? `<cac:TaxTotal>${amount(currency, text(totals["BT-110"]), "TaxAmount")}${list(semantic["BG-23"]).map((row) => taxSubtotal(currency, row)).join("")}</cac:TaxTotal>`
      : "") +
    (accounting && totals
      ? `<cac:TaxTotal>${amount(accounting, text(totals["BT-111"]), "TaxAmount")}</cac:TaxTotal>`
      : "") +
    (totals
      ? `<cac:LegalMonetaryTotal>${amount(currency, text(totals["BT-106"]), "LineExtensionAmount")}${amount(currency, text(totals["BT-109"]), "TaxExclusiveAmount")}${amount(currency, text(totals["BT-112"]), "TaxInclusiveAmount")}${amount(currency, text(totals["BT-113"]), "PrepaidAmount")}${amount(currency, text(totals["BT-114"]), "PayableRoundingAmount")}${amount(currency, text(totals["BT-115"]), "PayableAmount")}</cac:LegalMonetaryTotal>`
      : "") +
    list(semantic["BG-25"]).map((row) => line(currency, row, credit)).join("") +
    `</${root}>`;
}

function childText(node: unknown, name: string) {
  if (!node || typeof node !== "object") return null;
  const value = (node as Record<string, unknown>)[name];
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "#text" in value) return String((value as { "#text": unknown })["#text"]);
  return null;
}

function child(node: unknown, name: string) {
  if (!node || typeof node !== "object") return null;
  return (node as Record<string, unknown>)[name] ?? null;
}

function asList(value: unknown) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function partySemantic(node: unknown, role: "seller" | "buyer"): RecordJson | null {
  const partyNode = child(node, "Party") ?? node;
  if (!partyNode || typeof partyNode !== "object") return null;
  const endpoint = child(partyNode, "EndpointID") as { "@schemeID"?: string; "#text"?: string } | string | null;
  const legal = child(partyNode, "PartyLegalEntity");
  const tax = child(partyNode, "PartyTaxScheme");
  const identification = child(partyNode, "PartyIdentification");
  const postal = child(partyNode, "PostalAddress");
  const contact = child(partyNode, "Contact");
  const address: RecordJson = {};
  const street = childText(postal, "StreetName");
  const extra = childText(postal, "AdditionalStreetName");
  const line = childText(child(postal, "AddressLine"), "Line");
  const city = childText(postal, "CityName");
  const post = childText(postal, "PostalZone");
  const county = childText(postal, "CountrySubentity");
  const country = childText(child(postal, "Country"), "IdentificationCode");
  if (street) address["BT-35"] = street;
  if (extra) address["BT-36"] = extra;
  if (line) address["BT-162"] = line;
  if (city) address["BT-37"] = city;
  if (post) address["BT-38"] = post;
  if (county) address["BT-39"] = county;
  if (country) address["BT-40"] = country;
  const result: RecordJson = {};
  const name = childText(legal, "RegistrationName");
  const company = childText(legal, "CompanyID");
  const identifier = childText(identification, "ID");
  const vat = childText(tax, "CompanyID");
  if (role === "seller") {
    if (name) result["BT-27"] = name;
    if (identifier) result["BT-29"] = identifier;
    if (company) result["BT-30"] = company;
    if (vat) result["BT-31"] = vat;
    if (Object.keys(address).length) result["BG-5"] = address;
  } else {
    if (name) result["BT-44"] = name;
    if (identifier) result["BT-46"] = identifier;
    if (company) result["BT-47"] = company;
    if (vat) result["BT-48"] = vat;
    if (Object.keys(address).length) result["BG-8"] = address;
  }
  if (endpoint && typeof endpoint === "object") {
    result[role === "seller" ? "BT-34" : "BT-49"] = {
      scheme: endpoint["@schemeID"] ?? "",
      value: endpoint["#text"] ?? "",
    };
  }
  const contactName = childText(contact, "Name");
  const contactPhone = childText(contact, "Telephone");
  const contactEmail = childText(contact, "ElectronicMail");
  if (contactName || contactPhone || contactEmail) {
    const contactJson: RecordJson = {};
    if (role === "seller") {
      if (contactName) contactJson["BT-41"] = contactName;
      if (contactPhone) contactJson["BT-42"] = contactPhone;
      if (contactEmail) contactJson["BT-43"] = contactEmail;
      result["BG-6"] = contactJson;
    } else {
      if (contactName) contactJson["BT-56"] = contactName;
      if (contactPhone) contactJson["BT-57"] = contactPhone;
      if (contactEmail) contactJson["BT-58"] = contactEmail;
      result["BG-9"] = contactJson;
    }
  }
  return Object.keys(result).length ? result : null;
}

export function parseUbl(xml: string): RecordJson {
  rejectUnsafeXml(xml);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    removeNSPrefix: true,
    processEntities: false,
    htmlEntities: false,
    trimValues: false,
    parseTagValue: false,
  });
  const document = parser.parse(xml) as Record<string, unknown>;
  const credit = "CreditNote" in document;
  const root = (credit ? document.CreditNote : document.Invoice) as Record<string, unknown> | undefined;
  if (!root) throw new Error("The file must be a UBL 2.1 Invoice or CreditNote.");
  const unsupported: string[] = [];
  const currency = childText(root, "DocumentCurrencyCode") ?? "EUR";
  const result: RecordJson = {};
  const set = (key: string, value: string | null) => {
    if (value) result[key] = value;
  };
  set("BT-1", childText(root, "ID"));
  set("BT-2", childText(root, "IssueDate"));
  set("BT-3", childText(root, credit ? "CreditNoteTypeCode" : "InvoiceTypeCode"));
  set("BT-5", currency);
  set("BT-6", childText(root, "TaxCurrencyCode"));
  const due = childText(root, "DueDate") ?? childText(child(root, "PaymentMeans"), "PaymentDueDate");
  set("BT-9", due);
  set("BT-10", childText(root, "BuyerReference"));
  set("BT-12", childText(child(root, "ContractDocumentReference"), "ID"));
  set("BT-13", childText(child(root, "OrderReference"), "ID"));
  set("BT-20", childText(child(root, "PaymentTerms"), "Note"));
  set("BT-22", childText(root, "Note"));
  set("BT-23", childText(root, "ProfileID"));
  set("BT-24", childText(root, "CustomizationID"));
  set("BT-72", childText(child(root, "Delivery"), "ActualDeliveryDate"));

  const period = child(root, "InvoicePeriod");
  if (period) {
    result["BG-14"] = {
      ...(childText(period, "StartDate") ? { "BT-73": childText(period, "StartDate") } : {}),
      ...(childText(period, "EndDate") ? { "BT-74": childText(period, "EndDate") } : {}),
    };
  }
  const billing = child(child(root, "BillingReference"), "InvoiceDocumentReference");
  if (billing) {
    result["BG-3"] = {
      ...(childText(billing, "ID") ? { "BT-25": childText(billing, "ID") } : {}),
      ...(childText(billing, "IssueDate") ? { "BT-26": childText(billing, "IssueDate") } : {}),
    };
  }
  const seller = partySemantic(child(root, "AccountingSupplierParty"), "seller");
  const buyer = partySemantic(child(root, "AccountingCustomerParty"), "buyer");
  if (seller) result["BG-4"] = seller;
  if (buyer) result["BG-7"] = buyer;

  const means = child(root, "PaymentMeans");
  if (means) {
    const account = child(means, "PayeeFinancialAccount");
    const payment: RecordJson = {};
    if (childText(means, "PaymentMeansCode")) payment["BT-81"] = childText(means, "PaymentMeansCode")!;
    if (childText(means, "PaymentID")) payment["BT-83"] = childText(means, "PaymentID")!;
    if (account) {
      payment["BG-17"] = {
        ...(childText(account, "ID") ? { "BT-84": childText(account, "ID") } : {}),
        ...(childText(account, "Name") ? { "BT-85": childText(account, "Name") } : {}),
        ...(childText(child(account, "FinancialInstitutionBranch"), "ID")
          ? { "BT-86": childText(child(account, "FinancialInstitutionBranch"), "ID") }
          : {}),
      };
    }
    if (Object.keys(payment).length) result["BG-16"] = payment;
  }

  for (const allowance of asList(child(root, "AllowanceCharge"))) {
    const charge = childText(allowance, "ChargeIndicator") === "true";
    unsupported.push(charge ? "document charge" : "document allowance");
  }

  const taxTotals = asList(child(root, "TaxTotal"));
  const documentTax = taxTotals.find((total) => child(total, "TaxSubtotal")) ?? taxTotals[0];
  const accountingTax = taxTotals.find((total) => total !== documentTax);
  const monetary = child(root, "LegalMonetaryTotal");
  if (monetary || documentTax) {
    const totals: RecordJson = {};
    const put = (key: string, value: string | null) => {
      if (value) totals[key] = value;
    };
    put("BT-106", childText(monetary, "LineExtensionAmount"));
    put("BT-109", childText(monetary, "TaxExclusiveAmount"));
    put("BT-110", childText(documentTax, "TaxAmount"));
    put("BT-111", childText(accountingTax, "TaxAmount"));
    put("BT-112", childText(monetary, "TaxInclusiveAmount"));
    put("BT-113", childText(monetary, "PrepaidAmount"));
    put("BT-114", childText(monetary, "PayableRoundingAmount"));
    put("BT-115", childText(monetary, "PayableAmount"));
    result["BG-22"] = totals;
  }
  const breakdown = asList(child(documentTax, "TaxSubtotal")).map((row) => {
    const category = child(row, "TaxCategory");
    const item: RecordJson = {};
    const put = (key: string, value: string | null) => {
      if (value) item[key] = value;
    };
    put("BT-116", childText(row, "TaxableAmount"));
    put("BT-117", childText(row, "TaxAmount"));
    put("BT-118", childText(category, "ID"));
    put("BT-119", childText(category, "Percent"));
    put("BT-120", childText(category, "TaxExemptionReason"));
    put("BT-121", childText(category, "TaxExemptionReasonCode"));
    return item;
  });
  if (breakdown.length) result["BG-23"] = breakdown;

  const lines = asList(child(root, credit ? "CreditNoteLine" : "InvoiceLine")).map((row) => {
    const itemNode = child(row, "Item");
    const price = child(row, "Price");
    const tax = child(itemNode, "ClassifiedTaxCategory");
    const lineJson: RecordJson = {};
    const put = (key: string, value: string | null) => {
      if (value) lineJson[key] = value;
    };
    put("BT-126", childText(row, "ID"));
    put("BT-127", childText(row, "Note"));
    put("BT-129", childText(row, credit ? "CreditedQuantity" : "InvoicedQuantity"));
    const quantityNode = child(row, credit ? "CreditedQuantity" : "InvoicedQuantity") as { "@unitCode"?: string } | string | null;
    if (quantityNode && typeof quantityNode === "object" && quantityNode["@unitCode"]) lineJson["BT-130"] = quantityNode["@unitCode"];
    put("BT-131", childText(row, "LineExtensionAmount"));
    const allowances = asList(child(row, "AllowanceCharge")).map((allowance) => {
      if (childText(allowance, "ChargeIndicator") === "true") unsupported.push("line charge");
      const allowanceJson: RecordJson = {};
      if (childText(allowance, "Amount")) allowanceJson["BT-136"] = childText(allowance, "Amount")!;
      if (childText(allowance, "AllowanceChargeReasonCode")) allowanceJson["BT-140"] = childText(allowance, "AllowanceChargeReasonCode")!;
      return allowanceJson;
    });
    if (allowances.length) lineJson["BG-27"] = allowances;
    if (childText(price, "PriceAmount") || childText(price, "BaseQuantity")) {
      lineJson["BG-29"] = {
        ...(childText(price, "PriceAmount") ? { "BT-146": childText(price, "PriceAmount") } : {}),
        ...(childText(price, "BaseQuantity") ? { "BT-149": childText(price, "BaseQuantity") } : {}),
      };
    }
    if (childText(tax, "ID") || childText(tax, "Percent")) {
      lineJson["BG-30"] = {
        ...(childText(tax, "ID") ? { "BT-151": childText(tax, "ID") } : {}),
        ...(childText(tax, "Percent") ? { "BT-152": childText(tax, "Percent") } : {}),
      };
    }
    const sellerItem = childText(child(itemNode, "SellersItemIdentification"), "ID");
    if (childText(itemNode, "Name") || sellerItem) {
      lineJson["BG-31"] = {
        ...(childText(itemNode, "Name") ? { "BT-153": childText(itemNode, "Name") } : {}),
        ...(sellerItem ? { "BT-155": sellerItem } : {}),
      };
    }
    return lineJson;
  });
  if (lines.length) result["BG-25"] = lines;
  if (unsupported.length) result._unsupported = [...new Set(unsupported)];
  return result;
}
