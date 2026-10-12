import { redirect } from "next/navigation";
import ProductManager from "@/components/ProductManager";
import { getWorkspace } from "@/lib/data";
import { listProducts } from "@/lib/product-data";
import { listReference } from "@/lib/reference-data";

export const metadata = { title: "Products" };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const products = listProducts();
  const glCodes = listReference("gl_codes");
  const vatRates = listReference("vat_rates");
  const workspace = await getWorkspace();
  if (workspace.status === "signed-out") redirect("/login");
  if (workspace.status !== "ready") redirect("/");

  const [listed, gl, vat, params] = await Promise.all([products, glCodes, vatRates, searchParams]);
  const loadError = [listed.error, gl.error, vat.error].filter(Boolean).join(" ");

  return (
    <ProductManager
      rows={listed.rows}
      glCodes={gl.rows}
      vatRates={vat.rows}
      loadError={loadError || null}
      actionError={params.error}
    />
  );
}
