import { expect, test } from "bun:test";
import { documentText, MAX_TEXT_BYTES } from "../src/workspace/extract";

test("a CSV whose text is exactly the size cap is kept whole, without the clipped note", async () => {
  const text = [...Array.from({ length: MAX_TEXT_BYTES / 10 - 1 }, (_, i) => `r${String(i).padStart(5, "0")},ab\n`), "last,1234!"].join("");
  expect(Buffer.byteLength(text)).toBe(MAX_TEXT_BYTES);
  expect(await documentText("data.csv", new TextEncoder().encode(text))).toBe(`${text}\n`);
});

const PAGE = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>Harga cetak &amp; kafé</title>
  <style>p { color: red }</style>
  <script>var token = "zzhidden";</script>
</head>
<body>
  <nav><a href="/">Beranda</a></nav>
  <p>Brosur dicetak di <b>Sinar Printing</b>: 2.000 lembar, résumé terlampir.</p>
  <script>track("zzhidden")</script>
  <noscript>Aktifkan JavaScript</noscript>
  <template><p>Templat kosong</p></template>
  <svg><title>Ikon</title><path d="M0 0"/></svg>
  <iframe src="https://example.com/embed">Bingkai</iframe>
  <ul><li>Kertas A4</li><li>Kertas A5</li></ul>
  <p><img alt="Logo vendor" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAI"></p>
</body>
</html>`;

test("an HTML page becomes Markdown headed by its title; scripts, styles, frames and the rest of the head are dropped", async () => {
  expect(await documentText("harga.html", new TextEncoder().encode(PAGE))).toBe([
    "# Harga cetak & kafé",
    "",
    "[Beranda](/)",
    "",
    "Brosur dicetak di **Sinar Printing**: 2.000 lembar, résumé terlampir.",
    "",
    "- Kertas A4",
    "- Kertas A5",
    "",
    "[image: Logo vendor]",
    "",
  ].join("\n"));
});

test("an .htm page whose body has its own h1 is not headed by its title", async () => {
  const page = "<html><head><title>Situs vendor</title></head><body><h1>Daftar harga</h1><p>Brosur Rp 2.000 per lembar.</p></body></html>";
  expect(await documentText("vendor.htm", new TextEncoder().encode(page))).toBe("# Daftar harga\n\nBrosur Rp 2.000 per lembar.\n");
});
