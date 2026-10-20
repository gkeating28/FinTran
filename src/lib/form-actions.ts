"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getFormType } from "@/lib/form-data";
import { parseLayout } from "@/lib/form-layout";
import { getWorkspace } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

function text(formData: FormData, name: string) {
  return String(formData.get(name) ?? "");
}

export async function saveTransactionForm(_state: ActionState, formData: FormData): Promise<ActionState> {
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const loaded = await getFormType(text(formData, "code"));
  if (loaded.error) return { error: loaded.error };
  if (!loaded.type) return { error: "That transaction type is not in this organisation." };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text(formData, "layout") || "{}");
  } catch {
    return { error: "That form could not be saved." };
  }
  const layout = parseLayout(parsed, loaded.type.kind, loaded.type.description, loaded.type.documentKind);
  if (!layout.title.trim()) return { error: "Enter a document title." };
  if (layout.lineColumns.length === 0) return { error: "Choose at least one line column." };

  const supabase = await createClient();
  const { error } = await supabase.from("transaction_forms").upsert(
    {
      tenant_id: workspace.current.tenantId,
      organisation_id: workspace.current.organisationId,
      transaction_type_id: loaded.type.id,
      layout,
    },
    { onConflict: "organisation_id,transaction_type_id" },
  );

  if (error) return { error: error.message || "That form could not be saved." };

  revalidatePath("/forms");
  revalidatePath(`/forms/${loaded.type.code}`);
  revalidatePath("/admin");
  return { message: "Saved." };
}
