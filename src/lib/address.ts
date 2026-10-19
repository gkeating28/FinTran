export type PostalAddress = {
  line1: string;
  line2: string;
  line3: string;
  city: string;
  postCode: string;
  county: string;
  countryCode: string;
};

export const emptyPostalAddress: PostalAddress = {
  line1: "",
  line2: "",
  line3: "",
  city: "",
  postCode: "",
  county: "",
  countryCode: "IE",
};

export function formatPostalAddress(
  address: Partial<PostalAddress> & { countryName?: string | null },
) {
  return [address.line1, address.line2, address.line3, address.city, address.county, address.postCode, address.countryName || address.countryCode]
    .map((line) => (line ?? "").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function optionalLine(value: string, max: number) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) return undefined;
  return trimmed;
}

export function parsePostalAddress(input: PostalAddress): PostalAddress | { error: string } {
  const line1 = optionalLine(input.line1, 100);
  const line2 = optionalLine(input.line2, 100);
  const line3 = optionalLine(input.line3, 100);
  const city = optionalLine(input.city, 60);
  const county = optionalLine(input.county, 60);
  const postCode = optionalLine(input.postCode, 20);
  if (line1 === undefined) return { error: "Address line 1 can be up to 100 characters." };
  if (line2 === undefined) return { error: "Address line 2 can be up to 100 characters." };
  if (line3 === undefined) return { error: "Address line 3 can be up to 100 characters." };
  if (city === undefined) return { error: "City can be up to 60 characters." };
  if (county === undefined) return { error: "County can be up to 60 characters." };
  if (postCode === undefined) return { error: "Post code can be up to 20 characters." };
  const countryCode = input.countryCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{2}$/.test(countryCode) || countryCode === "EL") {
    return { error: "Choose a postal country." };
  }
  return {
    line1: line1 ?? "",
    line2: line2 ?? "",
    line3: line3 ?? "",
    city: city ?? "",
    postCode: postCode ?? "",
    county: county ?? "",
    countryCode,
  };
}

export function parseVatNumber(value: string) {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!compact) return null;
  if (!/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(compact)) return undefined;
  return compact;
}

export function parsePeppol(
  scheme: string,
  id: string,
): { peppolScheme: string | null; peppolId: string | null } | { error: string } {
  const peppolScheme = scheme.trim();
  const peppolId = id.trim();
  if (!peppolScheme && !peppolId) return { peppolScheme: null, peppolId: null };
  if (!peppolScheme || !peppolId) {
    return { error: "Enter both the Peppol scheme and the Peppol ID, or leave both blank." };
  }
  if (peppolId.length > 100) return { error: "Peppol ID can be up to 100 characters." };
  return { peppolScheme, peppolId };
}

export function parseIban(value: string) {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!compact) return null;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(compact)) return undefined;
  return compact;
}

export function parseBic(value: string) {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  if (!compact) return null;
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact)) return undefined;
  return compact;
}
