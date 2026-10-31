import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

export async function GET() {
  const directory = path.join(process.cwd(), "node_modules/dictionary-en-gb");
  const [aff, dic] = await Promise.all([
    readFile(path.join(directory, "index.aff"), "utf8"),
    readFile(path.join(directory, "index.dic"), "utf8"),
  ]);
  return Response.json(
    { aff, dic },
    { headers: { "Cache-Control": "public, max-age=86400" } },
  );
}
