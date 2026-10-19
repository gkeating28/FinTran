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
  address: string;
  contactDetails: string;
  notes: string;
  vatNumber: string;
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
  address: string | null;
  contactDetails: string | null;
  notes: string | null;
  vatNumber: string | null;
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
  address: string;
  contactDetails: string;
  notes: string;
  vatNumber: string;
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

  const address = optionalText(input.address, 500);
  if (address === undefined) return { error: "Address can be up to 500 characters." };

  const contactDetails = optionalText(input.contactDetails, 500);
  if (contactDetails === undefined) return { error: "Contact details can be up to 500 characters." };

  const notes = optionalText(input.notes, 4000);
  if (notes === undefined) return { error: "Notes can be up to 4000 characters." };

  const vatNumber = optionalText(input.vatNumber, 40);
  if (vatNumber === undefined || (vatNumber && !/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(vatNumber))) {
    return { error: "VAT number can be up to 40 characters and must start with a letter or number." };
  }

  return { code, name, currencyId, phone, email, website, address, contactDetails, notes, vatNumber };
}
