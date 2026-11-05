/**
 * Upsert City of Davenport iWorQ permits into data/davenport-harvest.json.
 *
 * Capture the search results (and any permit detail pages) with the browser's
 * Save Page / view-source after the captcha has been solved in that browser.
 * Server-side 2captcha tokens are not required and often fail with HTTP 302.
 *
 *   npx tsx scripts/ingest-davenport-harvest.ts fixtures/davenport-iworq/search-1832-buckeye.html fixtures/davenport-iworq/permit-210405-detail.html
 *   npx tsx scripts/ingest-davenport-harvest.ts --out data/davenport-harvest.json path/to/search.html path/to/detail.html
 *
 * Search HTML fills the address index. Detail HTML adds issued date, completion
 * date, contractor, and cost. Re-running the same files does not duplicate rows.
 * Commit the JSON and deploy. DAVENPORT_CAPTCHA_* stays optional once the
 * address is in the cache. Set DAVENPORT_IWORQ_ENABLED=false to skip the source.
 */
import path from "path";
import { fileURLToPath } from "url";
import { ingestHtmlFiles } from "../src/lib/providers/davenport-harvest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function usage(): string {
  return [
    "Usage: npx tsx scripts/ingest-davenport-harvest.ts [--out data/davenport-harvest.json] <search-or-detail.html> [...]",
    "Reads saved portal.iworq.net/DAVENPORT HTML and upserts permits into the harvest cache.",
  ].join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  let out = path.join(root, "data", "davenport-harvest.json");
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      return;
    }
    if (arg === "--out") {
      const next = args[++i];
      if (!next) throw new Error("--out needs a path");
      out = path.resolve(next);
      continue;
    }
    if (arg.startsWith("-")) throw new Error(`Unknown flag ${arg}\n${usage()}`);
    files.push(path.resolve(arg));
  }
  if (files.length === 0) {
    console.error(usage());
    process.exitCode = 1;
    return;
  }
  const doc = await ingestHtmlFiles(files, out);
  console.log(`Wrote ${doc.permits.length} permit${doc.permits.length === 1 ? "" : "s"} (${Object.keys(doc.addressIndex).length} address keys) to ${out}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
