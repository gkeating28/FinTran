// Checks that src/lib/database.types.ts describes every table and every column the migrations create.
//
// The migrations are read in order. A table comes from `create table public.x (...)`, and its columns from the lines
// inside the brackets and from later `alter table public.x add column` and `drop column` statements. The types file
// gives each table's columns under `Row`. A table or column that is in one and not the other fails the check, so a
// hand-written stub that lists only some of a table's columns cannot pass.
//
// Regenerate the types from the project and replace the file when this fails.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const migrations = path.join(process.cwd(), "supabase/migrations");
const types = readFileSync(path.join(process.cwd(), "src/lib/database.types.ts"), "utf8");

/** table name -> Set of column names, as the migrations leave them. */
const tables = new Map();

const NOT_A_COLUMN = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i;

for (const file of readdirSync(migrations).sort()) {
  const sql = readFileSync(path.join(migrations, file), "utf8");

  for (const match of sql.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)\s*\(([\s\S]*?)\n\);/gi)) {
    const columns = new Set();
    for (const line of match[2].split("\n")) {
      const column = /^\s{2,}"?([a-z0-9_]+)"?\s+\S/i.exec(line)?.[1];
      if (column && !NOT_A_COLUMN.test(column)) columns.add(column);
    }
    tables.set(match[1], columns);
  }

  for (const match of sql.matchAll(/alter table (?:only )?public\.([a-z0-9_]+)\s+([^;]+);/gi)) {
    const columns = tables.get(match[1]);
    if (!columns) continue;
    for (const added of match[2].matchAll(/add column (?:if not exists )?"?([a-z0-9_]+)"?/gi)) columns.add(added[1]);
    for (const dropped of match[2].matchAll(/drop column (?:if exists )?"?([a-z0-9_]+)"?/gi)) columns.delete(dropped[1]);
  }

  for (const match of sql.matchAll(/drop table (?:if exists )?public\.([a-z0-9_]+)/gi)) tables.delete(match[1]);
}

/** The columns the types file gives a table under Row, or null when the table is not there. */
function typedColumns(name) {
  const block = new RegExp(`\\n      ${name}: \\{\\n        Row: \\{\\n([\\s\\S]*?)\\n        \\}`).exec(types);
  if (!block) return null;
  return new Set([...block[1].matchAll(/^\s+"?([a-z0-9_]+)"?\??:/gim)].map((found) => found[1]));
}

const problems = [];
for (const [name, columns] of [...tables].sort(([a], [b]) => a.localeCompare(b))) {
  const typed = typedColumns(name);
  if (!typed) {
    problems.push(`table ${name} is missing`);
    continue;
  }
  const missing = [...columns].filter((column) => !typed.has(column));
  const extra = [...typed].filter((column) => !columns.has(column));
  if (missing.length) problems.push(`${name} is missing columns: ${missing.join(", ")}`);
  if (extra.length) problems.push(`${name} has columns the migrations do not create: ${extra.join(", ")}`);
}

if (problems.length) {
  console.error("database.types.ts does not match the migrations:\n  " + problems.join("\n  "));
  console.error("Regenerate the types from the project and replace src/lib/database.types.ts.");
  process.exit(1);
}
console.log(`database.types.ts matches the migrations: ${tables.size} tables and every column.`);
