#!/usr/bin/env node
// Checks that CORE.md and TECHNICAL.md still describe what is in the repository, so a rename or a removal cannot leave
// them naming something that is gone, and a new action, function or table cannot go undocumented.
//
//   node scripts/check-docs.mjs
//
// It reads files only. It checks names, not sentences: a rule described wrongly in prose is still the reader's to catch.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const problems = [];
const fail = (check, message) => problems.push(`${check}: ${message}`);

const core = read("CORE.md");
const technical = read("TECHNICAL.md");
const reference = existsSync(path.join(root, "docs/QULA_PLUS_REFERENCE.md")) ? read("docs/QULA_PLUS_REFERENCE.md") : "";
const docs = { "CORE.md": core, "TECHNICAL.md": technical, "docs/QULA_PLUS_REFERENCE.md": reference };
const allDocs = Object.values(docs).join("\n");

function walk(dir, keep) {
  const found = [];
  for (const entry of readdirSync(path.join(root, dir))) {
    const relative = `${dir}/${entry}`;
    const full = path.join(root, relative);
    if (statSync(full).isDirectory()) found.push(...walk(relative, keep));
    else if (keep(relative)) found.push(relative);
  }
  return found;
}

const migrations = readdirSync(path.join(root, "supabase/migrations")).filter((file) => file.endsWith(".sql")).sort();
const migrationText = migrations.map((file) => read(`supabase/migrations/${file}`)).join("\n");

// 1. Every file or folder a document names in backticks exists.
{
  const seen = new Set();
  for (const [name, text] of Object.entries(docs)) {
    for (const match of text.matchAll(/`((?:src|supabase|e2e|scripts|docs|specs|public|\.github)\/[A-Za-z0-9_./\[\]()\-]+)`/g)) {
      const target = match[1].replace(/[.,]+$/, "");
      if (seen.has(`${name}|${target}`)) continue;
      seen.add(`${name}|${target}`);
      if (!existsSync(path.join(root, target))) fail("paths", `${name} names ${target}, which does not exist`);
    }
  }
}

// 2. A migration a document names exists. Files older than the baseline were folded into it, so only later ones count.
{
  const baseline = migrations.find((file) => file.includes("_baseline"))?.slice(0, 14) ?? "0";
  for (const [name, text] of Object.entries(docs)) {
    for (const match of text.matchAll(/`(2026\d{10})(?:_[a-z0-9_]+)?`/g)) {
      if (match[1] <= baseline) continue;
      if (!migrations.some((file) => file.startsWith(match[1]))) fail("migrations", `${name} names migration ${match[1]}, which has no file`);
    }
  }
}

// 3. Server actions: each one in a "use server" file is in the Server actions table, and each one the table names exists.
{
  const section = technical.slice(technical.indexOf("## Server actions"), technical.indexOf("## Database functions"));
  const exported = new Map();
  for (const file of walk("src/lib", (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const text = read(file);
    if (!/^\s*["']use server["']/.test(text.slice(0, 300))) continue;
    for (const match of text.matchAll(/export async function ([A-Za-z0-9_]+)/g)) exported.set(match[1], file);
  }
  const named = new Set();
  for (const line of section.split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cells = line.split("|");
    for (const match of (cells[2] ?? "").matchAll(/`([A-Za-z0-9_]+)`/g)) named.add(match[1]);
  }
  for (const [action, file] of exported) if (!named.has(action)) fail("server actions", `${action} (${file}) is not in the Server actions table of TECHNICAL.md`);
  for (const action of named) if (!exported.has(action)) fail("server actions", `TECHNICAL.md lists ${action}, which no server action file exports`);
}

// 4. Database functions: every public function that still exists is described somewhere, and the ones the Database
// functions section names still exist.
{
  const created = new Set([...migrationText.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)/gi)].map((m) => m[1]));
  const dropped = new Set([...migrationText.matchAll(/drop function (?:if exists )?public\.([a-z_0-9]+)/gi)].map((m) => m[1]));
  const privateFunctions = new Set([...migrationText.matchAll(/create (?:or replace )?function private\.([a-z_0-9]+)/gi)].map((m) => m[1]));
  const alive = [...created].filter((fn) => !dropped.has(fn));
  for (const fn of alive) if (!new RegExp(`\\b${fn}\\b`).test(allDocs)) fail("database functions", `public.${fn} is not mentioned in any document`);
  const section = technical.slice(technical.indexOf("## Database functions"), technical.indexOf("## Database schema"));
  for (const match of section.matchAll(/`(?:public\.|private\.)?([a-z_0-9]+)\(/g)) {
    if (!alive.includes(match[1]) && !privateFunctions.has(match[1])) fail("database functions", `TECHNICAL.md describes ${match[1]}(), which no migration creates`);
  }
}

// 5. Every public table that still exists is mentioned.
{
  const created = new Set([...migrationText.matchAll(/create table (?:if not exists )?public\.([a-z_0-9]+)/gi)].map((m) => m[1]));
  const dropped = new Set([...migrationText.matchAll(/drop table (?:if exists )?public\.([a-z_0-9]+)/gi)].map((m) => m[1]));
  for (const table of created) if (!dropped.has(table) && !new RegExp(`\\b${table}\\b`).test(allDocs)) fail("tables", `public.${table} is not mentioned in any document`);
}

// 6. The form designer's field lists in CORE.md match the code.
{
  const code = read("src/lib/form-layout.ts");
  const lists = [
    ["ORGANISATION_FIELDS", "Allowed organisation fields"],
    ["PARTY_FIELDS", "Allowed bill-to fields"],
    ["HEADER_FIELDS", "Allowed document fields"],
    ["LINE_COLUMNS", "Allowed line columns"],
  ];
  for (const [constant, label] of lists) {
    const block = new RegExp(`${constant} = \\[(.*?)\\] as const`, "s").exec(code)?.[1] ?? "";
    const inCode = new Set([...block.matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1]));
    const line = core.split("\n").find((l) => l.startsWith(label)) ?? "";
    const inDoc = new Set([...line.matchAll(/`([A-Za-z0-9]+)`/g)].map((m) => m[1]));
    if (constant === "HEADER_FIELDS" && /flex1/.test(line)) for (let i = 1; i <= 5; i += 1) inDoc.add(`flex${i}`);
    for (const field of inCode) if (!inDoc.has(field)) fail("form fields", `CORE.md "${label}" leaves out ${field}`);
    for (const field of inDoc) if (!inCode.has(field)) fail("form fields", `CORE.md "${label}" names ${field}, which the designer does not offer`);
  }
}

// 7. The end-to-end flows table in TECHNICAL.md has a row for every numbered flow in the specs, and no others.
{
  const inCode = new Set();
  for (const file of walk("e2e", (f) => f.endsWith(".spec.ts"))) {
    for (const match of read(file).matchAll(/test\(\s*["'`]flow (\d+):/g)) inCode.add(Number(match[1]));
  }
  const section = technical.slice(technical.indexOf("### End-to-end tests"));
  const inDoc = new Set([...section.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1])));
  for (const n of inCode) if (!inDoc.has(n)) fail("e2e flows", `flow ${n} is in the specs and not in the table in TECHNICAL.md`);
  for (const n of inDoc) if (!inCode.has(n)) fail("e2e flows", `the table in TECHNICAL.md has flow ${n}, which no spec has`);
}

if (problems.length > 0) {
  console.error(`The documents have drifted from the code (${problems.length}):\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("\nFix the document, or the code if the document is right. This checks names, not sentences.");
  process.exit(1);
}
console.log("The documents match the code: paths, migrations, server actions, database functions, tables, form fields and flows.");
