import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const migrations = path.join(process.cwd(), "supabase/migrations");
const types = readFileSync(path.join(process.cwd(), "src/lib/database.types.ts"), "utf8");
const missing = [];
for (const file of readdirSync(migrations)) {
  const sql = readFileSync(path.join(migrations, file), "utf8");
  for (const match of sql.matchAll(/create table public\.([a-z0-9_]+)/gi)) {
    const name = match[1];
    if (!types.includes(`${name}: {`)) missing.push(name);
  }
}
if (missing.length) {
  console.error("database.types.ts is missing tables:", [...new Set(missing)].join(", "));
  process.exit(1);
}
console.log("database.types.ts includes every migrated table.");
