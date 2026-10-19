import { getWorkspace } from "@/lib/data";
import { formatProductPrice, type ProductRow } from "@/lib/products";
import { createClient } from "@/lib/supabase/server";

type Related = { code: string } | { code: string }[] | null;

type ProductRecord = {
  id: string;
  code: string;
  description: string;
  unit_code: string;
  purchase_price: string | number;
  sales_price: string | number;
  purchase_gl_code_id: string;
  sales_gl_code_id: string;
  purchase_vat_code_id: string;
  sales_vat_code_id: string;
  purchase_gl: Related;
  sales_gl: Related;
  purchase_vat: Related;
  sales_vat: Related;
};

function relatedCode(value: Related) {
  if (!value) return "";
  return Array.isArray(value) ? (value[0]?.code ?? "") : value.code;
}

export async function listProducts(): Promise<{
  rows: ProductRow[];
  error: string | null;
}> {
  const workspace = await getWorkspace();
  if (workspace.status !== "ready") return { rows: [], error: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      `id, code, description, unit_code, purchase_price, sales_price,
       purchase_gl_code_id, sales_gl_code_id, purchase_vat_code_id, sales_vat_code_id,
       purchase_gl:gl_codes!products_purchase_gl_code_id_fkey(code),
       sales_gl:gl_codes!products_sales_gl_code_id_fkey(code),
       purchase_vat:vat_rates!products_purchase_vat_code_id_fkey(code),
       sales_vat:vat_rates!products_sales_vat_code_id_fkey(code)`,
    )
    .eq("organisation_id", workspace.current.organisationId)
    .order("code");

  if (error) return { rows: [], error: "Products could not be loaded." };

  return {
    rows: ((data ?? []) as ProductRecord[]).map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      unitCode: row.unit_code,
      purchasePrice: formatProductPrice(row.purchase_price),
      salesPrice: formatProductPrice(row.sales_price),
      purchaseGlCodeId: row.purchase_gl_code_id,
      purchaseGlCode: relatedCode(row.purchase_gl),
      salesGlCodeId: row.sales_gl_code_id,
      salesGlCode: relatedCode(row.sales_gl),
      purchaseVatCodeId: row.purchase_vat_code_id,
      purchaseVatCode: relatedCode(row.purchase_vat),
      salesVatCodeId: row.sales_vat_code_id,
      salesVatCode: relatedCode(row.sales_vat),
    })),
    error: null,
  };
}
