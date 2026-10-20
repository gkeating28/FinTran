const SELLER_TERMS = new Set(["BT-27", "BT-29", "BT-30", "BT-31", "BT-34", "BG-5", "BT-35", "BT-40"]);
const BUYER_TERMS = new Set(["BT-44", "BT-46", "BT-47", "BT-48", "BT-49", "BG-8", "BT-55"]);

export function purchaseReadinessHref(term: string) {
  if (SELLER_TERMS.has(term) || term === "BT-84") return "/suppliers";
  if (BUYER_TERMS.has(term)) return "/organisations";
  return null;
}
