import { redirect } from "next/navigation";

/** The ledger now lives under Reports as the General Ledger. Old links and bookmarks keep their filters. */
export default async function LedgerRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, item);
  }
  const query = params.toString();
  redirect(`/reports/general-ledger${query ? `?${query}` : ""}`);
}
