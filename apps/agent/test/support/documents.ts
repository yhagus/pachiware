/** Document fixtures for Discord scenarios: a real one-page PDF, a real DOCX and a real XLSX built from the given text, byte-stable per input. */
import { deflateSync } from "node:zlib";

const enc = new TextEncoder();

/** A PDF with one line of Helvetica per entry and a valid xref table. The page stream is deflated, as real PDFs are, so the words are not in the raw bytes. */
export function pdf(lines: string[]) {
  // The page grows with the text, since pdf.js drops lines that fall below it.
  const height = Math.max(792, lines.length * 14 + 144);
  const content = deflateSync(`BT /F1 12 Tf 72 ${height - 72} Td 14 TL ${lines.map((l) => `(${l.replace(/[\\()]/g, "\\$&")}) Tj T*`).join(" ")} ET`);
  const objects: (string | Uint8Array)[][] = [
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`],
    [`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, content, "\nendstream"],
    ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
  ];
  const parts: Uint8Array[] = [enc.encode("%PDF-1.4\n")];
  let size = parts[0]!.length;
  const push = (p: string | Uint8Array) => { const b = typeof p === "string" ? enc.encode(p) : p; parts.push(b); size += b.length; };
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(size); push(`${i + 1} 0 obj\n`); o.forEach(push); push("\nendobj\n"); });
  const xref = size;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * A scanned PDF: one page per entry, each only a gray RGB image with no text layer, as a scanner makes it; the shade varies by page so
 * pages differ. Byte-stable per input.
 */
export function scannedPdf(pages: number, side = 200) {
  const objects: (string | Uint8Array)[][] = [["<< /Type /Catalog /Pages 2 0 R >>"], [`<< /Type /Pages /Kids [${Array.from({ length: pages }, (_, i) => `${3 + i * 3} 0 R`).join(" ")}] /Count ${pages} >>`]];
  for (let i = 0; i < pages; i++) {
    const page = 3 + i * 3, contents = page + 1, image = page + 2;
    const pixels = deflateSync(new Uint8Array(side * side * 3).fill(120 + i * 20)), draw = `q 500 0 0 500 50 150 cm /Im0 Do Q`;
    objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R /Resources << /XObject << /Im0 ${image} 0 R >> >> >>`]);
    objects.push([`<< /Length ${draw.length} >>\nstream\n${draw}\nendstream`]);
    objects.push([`<< /Type /XObject /Subtype /Image /Width ${side} /Height ${side} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`, pixels, "\nendstream"]);
  }
  const parts: Uint8Array[] = [enc.encode("%PDF-1.4\n")];
  let size = parts[0]!.length;
  const push = (p: string | Uint8Array) => { const b = typeof p === "string" ? enc.encode(p) : p; parts.push(b); size += b.length; };
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(size); push(`${i + 1} 0 obj\n`); o.forEach(push); push("\nendobj\n"); });
  const xref = size;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}

/** A DOCX with one paragraph per entry: the three parts Word needs, stored uncompressed. */
export function docx(paragraphs: string[]) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return zip({
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
  });
}

type Cell = string | number | { formula: string; result: number } | { date: string } | null;

/** An XLSX with one worksheet per entry: inline strings, numbers, dates (`m/d/yyyy` format), and formulas with their cached result. */
export function xlsx(sheets: Record<string, Cell[][]>) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const col = (i: number): string => (i >= 26 ? col(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));
  const cell = (c: Cell, ref: string) => c === null ? "" : typeof c === "string" ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>` : typeof c === "number" ? `<c r="${ref}"><v>${c}</v></c>` : "date" in c ? `<c r="${ref}" s="1"><v>${(Date.parse(c.date) - Date.UTC(1899, 11, 30)) / 86400000}</v></c>` : `<c r="${ref}"><f>${esc(c.formula)}</f><v>${c.result}</v></c>`;
  const names = Object.keys(sheets), parts: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };
  names.forEach((n, i) => {
    const rows = sheets[n]!.map((r, y) => `<row r="${y + 1}">${r.map((c, x) => cell(c, `${col(x)}${y + 1}`)).join("")}</row>`).join("");
    parts[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;
  });
  return zip(parts);
}

// Local headers, central directory, end record; method 0 (stored) so no deflate is needed.
function zip(entries: Record<string, string>) {
  const locals: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0, count = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameBytes = enc.encode(name), data = enc.encode(text), crc = Bun.hash.crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nameBytes.length, true); cd.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push(new Uint8Array(cd.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
    count++;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, count, true); end.setUint16(10, count, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Uint8Array(Buffer.concat([...locals, ...central, new Uint8Array(end.buffer)]));
}
