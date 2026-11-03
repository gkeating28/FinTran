<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FinTran

A saved master code is read-only. GL codes, departments, cost centres, VAT rates, customers, suppliers, products, currencies, and transaction types take their code when the row is created. After that save, the edit form shows the code and does not accept a new one. Do not add a way to change a saved code. Updates leave the code out, and Postgres rejects a rename.

Transaction entry screens use the purchase invoice shell in `src/components/PurchaseInvoiceManager.tsx`. One status row, then Document, Notes, and Payment. Header and totals stay on the left. The line grid stays on the right. Use the classes in `src/components/OpsPage.module.css`. Copy an existing control before adding CSS. One message occupies the status row. The exchange rate is read-only when the party currency is the organisation home currency. Ask Qula is the sparkle button at the right of the title bar. The chat slides in from the right. Do not float it over the page or the footer. Buttons on the navy chrome use the outline in `src/components/ChromeControl.module.css`.
