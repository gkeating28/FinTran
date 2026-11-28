"use client";

import OptionLookup from "@/components/OptionLookup";
import type { CodeName } from "@/lib/code-lists";

/** The Peppol scheme of an organisation or a party, chosen from the code list. */
export default function SchemeLookup({
  schemes,
  value,
  onChange,
}: {
  schemes: CodeName[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <OptionLookup
      name="peppol_scheme"
      label="Peppol scheme"
      searchLabel="Search Peppol schemes"
      emptyText="No schemes match."
      options={schemes.map((scheme) => ({ value: scheme.code, label: `${scheme.code} — ${scheme.name}` }))}
      value={value}
      onChange={onChange}
    />
  );
}
