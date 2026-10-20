const ADMIN_PAGES = new Set([
  "/gl-codes",
  "/departments",
  "/cost-centres",
  "/vat-rates",
  "/currencies",
  "/transaction-types",
  "/products",
  "/organisations",
  "/access",
  "/forms",
  "/history",
]);

const HOME_PAGES = new Set(["/transactions", "/customers", "/suppliers", "/admin"]);

export function previousPage(pathname: string): string | null {
  if (pathname === "/") return null;
  if (/^\/transactions\/[^/]+$/.test(pathname)) return "/transactions";
  if (/^\/forms\/[^/]+$/.test(pathname)) return "/forms";
  if (ADMIN_PAGES.has(pathname)) return "/admin";
  if (HOME_PAGES.has(pathname)) return "/";
  const parent = pathname.replace(/\/[^/]+$/, "");
  return parent || "/";
}
