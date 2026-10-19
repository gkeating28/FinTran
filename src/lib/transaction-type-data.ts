import { getWorkspace } from "@/lib/data";
import {
  parseDocumentKind,
  parseTransactionTypeKind,
  type TransactionTypeKind,
  type TransactionTypeRow,
} from "@/lib/transaction-types";
import { createClient } from "@/lib/supabase/server";

export async function listTransactionTypes(): Promise<{
  rows: TransactionTypeRow[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], error: null };

  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;
  const [types, headers] = await Promise.all([
    supabase
      .from("transaction_types")
      .select(
        "id, code, description, last_reference, type, document_kind, numbering, flex1_label, flex2_label, flex3_label, flex4_label, flex5_label",
      )
      .eq("organisation_id", organisationId)
      .order("code"),
    supabase.from("transaction_headers").select("transaction_type_id").eq("organisation_id", organisationId),
  ]);

  if (types.error || headers.error) return { rows: [], error: "Transaction types could not be loaded." };

  const counts = new Map<string, number>();
  for (const header of headers.data ?? []) {
    counts.set(header.transaction_type_id, (counts.get(header.transaction_type_id) ?? 0) + 1);
  }

  return {
    rows: (types.data ?? []).flatMap((row) => {
      const type = parseTransactionTypeKind(row.type);
      const documentKind = parseDocumentKind(row.document_kind);
      if (!type || !documentKind) return [];
      return [
        {
          id: row.id,
          code: row.code,
          description: row.description,
          lastReference: row.last_reference,
          type,
          documentKind,
          documentCount: counts.get(row.id) ?? 0,
          numbering: row.numbering === "on_post" ? "on_post" : "on_insert",
          flexLabels: [
            row.flex1_label ?? "",
            row.flex2_label ?? "",
            row.flex3_label ?? "",
            row.flex4_label ?? "",
            row.flex5_label ?? "",
          ],
        },
      ];
    }),
    error: null,
  };
}

export type TransactionMenuTile = {
  id: string;
  code: string;
  description: string;
  type: TransactionTypeKind;
  count: number;
};

export async function listTransactionMenu(): Promise<{
  tiles: TransactionMenuTile[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { tiles: [], error: null };

  const supabase = await createClient();
  const organisationId = workspace.current.organisationId;
  const [types, headers] = await Promise.all([
    supabase
      .from("transaction_types")
      .select("id, code, description, type")
      .eq("organisation_id", organisationId)
      .order("code"),
    supabase.from("transaction_headers").select("transaction_type_id").eq("organisation_id", organisationId),
  ]);

  if (types.error || headers.error) {
    return { tiles: [], error: "Transaction types could not be loaded." };
  }

  const counts = new Map<string, number>();
  for (const header of headers.data ?? []) {
    counts.set(header.transaction_type_id, (counts.get(header.transaction_type_id) ?? 0) + 1);
  }

  const tiles = (types.data ?? []).flatMap((row) => {
    const type = parseTransactionTypeKind(row.type);
    if (!type) return [];
    return [
      {
        id: row.id,
        code: row.code,
        description: row.description,
        type,
        count: counts.get(row.id) ?? 0,
      },
    ];
  });

  tiles.sort((left, right) => {
    if (left.type !== right.type) return left.type === "Purchases" ? -1 : 1;
    return left.code.localeCompare(right.code);
  });

  return { tiles, error: null };
}

export async function getTransactionTypeByCode(code: string): Promise<{
  tile: TransactionMenuTile | null;
  error: string | null;
}> {
  const menu = await listTransactionMenu();
  if (menu.error) return { tile: null, error: menu.error };
  const wanted = code.trim().toUpperCase();
  return { tile: menu.tiles.find((tile) => tile.code === wanted) ?? null, error: null };
}
