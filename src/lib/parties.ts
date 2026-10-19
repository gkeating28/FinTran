import { parsePeppol, parsePostalAddress, parseVatNumber, type PostalAddress } from "@/lib/address";

export const PARTY_KINDS = ["customers", "suppliers"] as const;

export type PartyKind = (typeof PARTY_KINDS)[number];

export type PartyRow = {
  id: string;
  code: string;
  name: string;
  currencyId: string;
  currencyCode: string;
  phone: string;
  email: string;
  website: string;
  addressLine1: string;
  addressLine2: string;
  addressLine3: string;
  city: string;
  postCode: string;
  county: string;
  countryCode: string;
  addressNeedsReview: boolean;
  contactDetails: string;
  notes: string;
  vatNumber: string;
  companyNumber: string;
  peppolScheme: string;
  peppolId: string;
  paymentTermsDays: string;
  defaultBuyerReference: string;
};

export type PartyCurrency = {
  id: string;
  code: string;
  name: string;
};

export const PARTY_META: Record<
  PartyKind,
  { path: string; title: string; singular: string; lede: string }
> = {
  customers: {
    path: "/customers",
    title: "Customers",
    singular: "customer",
    lede: "Customers for this organisation. Each has a code, name, currency, and contact details, plus a free-text note.",
  },
  suppliers: {
    path: "/suppliers",
    title: "Suppliers",
    singular: "supplier",
    lede: "Suppliers for this organisation. Each has a code, name, currency, and contact details, plus a free-text note.",
  },
};

export type PartyFields = {
  code: string;
  name: string;
  currencyId: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  city: string | null;
  postCode: string | null;
  county: string | null;
  countryCode: string;
  contactDetails: string | null;
  notes: string | null;
  vatNumber: string | null;
  companyNumber: string | null;
  peppolScheme: string | null;
  peppolId: string | null;
  paymentTermsDays: number | null;
  defaultBuyerReference: string | null;
};

function optionalText(value: string, max: number) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

export function parseParty(input: {
  code: string;
  name: string;
  currencyId: string;
  phone: string;
  email: string;
  website: string;
  address: PostalAddress;
  contactDetails: string;
  notes: string;
  vatNumber: string;
  companyNumber: string;
  peppolScheme: string;
  peppolId: string;
  paymentTermsDays: string;
  defaultBuyerReference: string;
}): PartyFields | { error: string } {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const currencyId = input.currencyId.trim();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(code) || name.length < 1 || name.length > 200) {
    return { error: "Start the code with a letter or number. Then use letters, numbers, dots, or hyphens, up to 20 characters." };
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currencyId)) {
    return { error: "Choose a currency." };
  }

  const phone = optionalText(input.phone, 40);
  if (phone === undefined || (phone && !/^[0-9+(). -]+$/.test(phone))) {
    return { error: "Use a phone number up to 40 characters." };
  }

  const email = optionalText(input.email, 200);
  if (email === undefined || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { error: "Use an email address, or leave it blank." };
  }

  const website = optionalText(input.website, 200);
  if (website === undefined || (website && /\s/.test(website))) {
    return { error: "Use a website up to 200 characters, without spaces." };
  }

  const address = parsePostalAddress(input.address);
  if ("error" in address) return address;

  const contactDetails = optionalText(input.contactDetails, 500);
  if (contactDetails === undefined) return { error: "Contact details can be up to 500 characters." };

  const notes = optionalText(input.notes, 4000);
  if (notes === undefined) return { error: "Notes can be up to 4000 characters." };

  const vatNumber = parseVatNumber(input.vatNumber);
  if (vatNumber === undefined) {
    return { error: "Enter a VAT number with a country prefix, for example IE1234567T." };
  }

  const companyNumber = optionalText(input.companyNumber, 40);
  if (companyNumber === undefined || (companyNumber && !/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(companyNumber))) {
    return { error: "Company number can be up to 40 letters or numbers." };
  }

  const peppol = parsePeppol(input.peppolScheme, input.peppolId);
  if ("error" in peppol) return { error: peppol.error };

  const termsText = input.paymentTermsDays.trim();
  let paymentTermsDays: number | null = null;
  if (termsText) {
    if (!/^\d{1,3}$/.test(termsText) || Number(termsText) > 365) {
      return { error: "Payment terms must be a whole number of days from 0 to 365." };
    }
    paymentTermsDays = Number(termsText);
  }
  const defaultBuyerReference = optionalText(input.defaultBuyerReference, 100);
  if (defaultBuyerReference === undefined) return { error: "Buyer reference can be up to 100 characters." };

  return {
    code,
    name,
    currencyId,
    phone,
    email,
    website,
    addressLine1: address.line1 || null,
    addressLine2: address.line2 || null,
    addressLine3: address.line3 || null,
    city: address.city || null,
    postCode: address.postCode || null,
    county: address.county || null,
    countryCode: address.countryCode,
    contactDetails,
    notes,
    vatNumber,
    companyNumber,
    peppolScheme: peppol.peppolScheme,
    peppolId: peppol.peppolId,
    paymentTermsDays,
    defaultBuyerReference,
  };
}
