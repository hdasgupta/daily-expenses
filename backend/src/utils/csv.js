import { parse } from "csv-parse/sync";

export function parseCsv(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  return parse(text, {
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });
}
