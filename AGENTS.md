<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# FinTran

A saved master code is read-only. GL codes, departments, cost centres, VAT rates, customers, suppliers, products, currencies, and transaction types take their code when the row is created. After that save, the edit form shows the code and does not accept a new one. Do not add a way to change a saved code. Updates leave the code out, and Postgres rejects a rename.
