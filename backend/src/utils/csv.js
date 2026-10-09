import { Readable } from "node:stream";
import { parse } from "csv-parse";

const CSV_CHUNK_SIZE = 64 * 1024;

/**
 * Parse CSV incrementally. Yielding between input chunks keeps large uploads from
 * monopolizing the Node.js event loop while preserving the existing row-array API.
 */
export async function parseCsv(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const chunks = (async function* () {
    for (let offset = 0; offset < text.length; offset += CSV_CHUNK_SIZE) {
      yield text.slice(offset, offset + CSV_CHUNK_SIZE);
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();

  const input = Readable.from(chunks);
  const parser = parse({
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
  input.pipe(parser);

  const rows = [];
  for await (const record of parser) rows.push(record);
  return rows;
}
