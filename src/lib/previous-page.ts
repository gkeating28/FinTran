const ADMIN_PAGES = new Set([
  "/gl-codes",
  "/departments",
  "/cost-centres",
  "/vat-rates",
  "/currencies",
  "/bank-accounts",
  "/approval-rules",
  "/transaction-types",
  "/products",
  "/organisations",
  "/access",
  "/forms",
  "/history",
  "/journal-export",
]);

const HOME_PAGES = new Set(["/transactions", "/customers", "/suppliers", "/admin", "/e-documents", "/reports"]);

/**
 * The main menu item a screen sits under, so the menu shows where the person is. Every Admin screen is under Admin, including
 * the forms designer and the change history, and Payment runs is under Transactions.
 */
export function menuItemFor(pathname: string): string {
  if (pathname === "/") return "/";
  if (pathname === "/admin" || ADMIN_PAGES.has(pathname) || pathname.startsWith("/forms/")) return "/admin";
  if (pathname === "/payment-runs") return "/transactions";
  return `/${pathname.split("/")[1]}`;
}

export function previousPage(pathname: string): string | null {
  if (pathname === "/") return null;
  if (/^\/transactions\/[^/]+$/.test(pathname)) return "/transactions";
  if (/^\/forms\/[^/]+$/.test(pathname)) return "/forms";
  if (pathname === "/payment-runs") return "/transactions";
  if (/^\/reports\/[^/]+$/.test(pathname)) return "/reports";
  if (ADMIN_PAGES.has(pathname)) return "/admin";
  if (HOME_PAGES.has(pathname)) return "/";
  const parent = pathname.replace(/\/[^/]+$/, "");
  return parent || "/";
}
