import { describe, expect, it } from "vitest";
import { PDFDict, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream } from "@cantoo/pdf-lib";
import { readMetadata, writeMetadata } from "@/pdf/tools/metadata";
import { fieldNames, infoOf, makePdf, openPdf, pageLabels } from "./helpers";

const FULL = {
  title: "Informe anual",
  author: "Álvaro Liébana",
  subject: "Cuentas 2025",
  keywords: ["finanzas", "informe"],
  creator: "Mi Programa 1.0",
  producer: "Otro Motor",
  creationDate: new Date("2024-03-05T10:20:30Z"),
  modificationDate: new Date("2024-04-06T11:21:31Z"),
};

async function infoDictOf(bytes: Uint8Array): Promise<PDFDict | undefined> {
  const doc = await openPdf(bytes);
  return doc.context.lookupMaybe(doc.context.trailerInfo.Info, PDFDict);
}

describe("readMetadata", () => {
  it("reads every property of a document", async () => {
    const meta = await readMetadata(await makePdf({ pages: 3, meta: FULL }));
    expect(meta).toEqual({
      title: "Informe anual",
      author: "Álvaro Liébana",
      subject: "Cuentas 2025",
      keywords: "finanzas informe", // as stored: pdf-lib joins a list with spaces
      creator: "Mi Programa 1.0",
      producer: "Otro Motor",
      creationDate: FULL.creationDate,
      modificationDate: FULL.modificationDate,
      pageCount: 3,
    });
  });

  it("gives empty strings and null dates for what the file does not have", async () => {
    expect(await readMetadata(await makePdf({ pages: 2 }))).toEqual({
      title: "",
      author: "",
      subject: "",
      keywords: "",
      creator: "",
      producer: "",
      creationDate: null,
      modificationDate: null,
      pageCount: 2,
    });
  });

  it("does not let pdf-lib stamp its own name as creator or producer", async () => {
    const meta = await readMetadata(await makePdf({ meta: { creator: "Escritor" } }));
    expect(meta.creator).toBe("Escritor");
    expect(meta.producer).toBe("");
  });

  it("copes with malformed entries", async () => {
    const doc = await openPdf(await makePdf({ meta: { title: "Bien" } }));
    const info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict);
    info.set(PDFName.of("Author"), PDFNumber.of(42)); // not a string
    info.set(PDFName.of("CreationDate"), PDFString.of("ayer por la tarde")); // not a date
    info.set(PDFName.of("ModDate"), PDFString.of("D:99999999999999")); // looks like one, is not
    info.set(PDFName.of("Subject"), PDFString.of("Texto plano")); // literal string, not hex
    const meta = await readMetadata(await doc.save());
    expect(meta.title).toBe("Bien");
    expect(meta.author).toBe("");
    expect(meta.creationDate).toBeNull();
    expect(meta.modificationDate).toBeNull();
    expect(meta.subject).toBe("Texto plano");
  });
});

describe("writeMetadata", () => {
  it("round-trips title, author, subject, keywords and creator, Unicode included", async () => {
    const values = {
      title: "Ñandú – 日本語 🙂",
      author: "Zoë Çelik",
      subject: "Líneas\ny saltos",
      keywords: "uno, dos, tres cuatro",
      creator: "Editor «snow»",
    };
    const out = await writeMetadata(await makePdf({ pages: 2 }), values);
    const meta = await readMetadata(out);
    expect(meta).toMatchObject(values);
    // and another implementation reads the same
    expect(infoOf(out, "Title")).toBe(values.title);
    expect(infoOf(out, "Author")).toBe(values.author);
    expect(infoOf(out, "Keywords")).toBe(values.keywords);
    expect(infoOf(out, "Creator")).toBe(values.creator);
  });

  it("stores keywords exactly as typed (comma separated)", async () => {
    const out = await writeMetadata(await makePdf(), { keywords: "a,b, c" });
    expect((await readMetadata(out)).keywords).toBe("a,b, c");
  });

  it("leaves untouched what is not mentioned", async () => {
    const original = await makePdf({ meta: FULL });
    const out = await writeMetadata(original, { title: "Nuevo título" });
    const meta = await readMetadata(out);
    expect(meta.title).toBe("Nuevo título");
    expect(meta.author).toBe(FULL.author);
    expect(meta.subject).toBe(FULL.subject);
    expect(meta.keywords).toBe("finanzas informe");
    expect(meta.creator).toBe(FULL.creator);
    expect(meta.creationDate).toEqual(FULL.creationDate);
  });

  it("does not overwrite the creator with pdf-lib's name, and stamps producer and modification date", async () => {
    const before = Date.now();
    const out = await writeMetadata(await makePdf({ meta: { creator: "Mi Programa", producer: "Viejo" } }), { title: "T" });
    const meta = await readMetadata(out);
    expect(meta.creator).toBe("Mi Programa");
    expect(meta.producer).toBe("SnowPDF");
    expect(meta.modificationDate!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(meta.modificationDate!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const raw = String(await infoDictOf(out)); // << /Creator <...> /Producer <...> ... >>
    expect(raw).toContain("/Creator");
    expect(raw.toLowerCase()).not.toContain("pdf-lib");
    const utf16 = Array.from("pdf-lib", (c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase();
    expect(raw).not.toContain(utf16); // pdf-lib writes its text strings as UTF-16 hex
  });

  it("changes the creator only when asked", async () => {
    const out = await writeMetadata(await makePdf({ meta: { creator: "Mi Programa" } }), { creator: "Otro" });
    expect((await readMetadata(out)).creator).toBe("Otro");
  });

  it("removes an entry when given an empty (or blank) string", async () => {
    const out = await writeMetadata(await makePdf({ meta: FULL }), { title: "", author: "   ", keywords: "" });
    const info = (await infoDictOf(out))!;
    for (const key of ["Title", "Author", "Keywords"]) expect(info.has(PDFName.of(key)), key).toBe(false);
    const meta = await readMetadata(out);
    expect(meta.title).toBe("");
    expect(meta.author).toBe("");
    expect(meta.keywords).toBe("");
    expect(meta.subject).toBe(FULL.subject); // the others stay
  });

  it("works on a file that has no Info dictionary at all, and trims the values", async () => {
    const out = await writeMetadata(await makePdf(), { title: "  Con espacios  ", author: "A" });
    const meta = await readMetadata(out);
    expect(meta.title).toBe("Con espacios");
    expect(meta.author).toBe("A");
    expect(meta.creationDate).toBeNull();
    expect(infoOf(out, "Title")).toBe("Con espacios");
  });

  it("changes nothing when given nothing, apart from the usual stamp", async () => {
    const original = await makePdf({ pages: 2, meta: FULL });
    const meta = await readMetadata(await writeMetadata(original, {}));
    expect(meta).toMatchObject({ title: FULL.title, author: FULL.author, creator: FULL.creator, producer: "SnowPDF", pageCount: 2 });
  });

  it("does not touch pages or forms", async () => {
    const out = await writeMetadata(await makePdf({ pages: 3, withForm: true, rotations: [90, 0, 180] }), { title: "X" });
    expect(pageLabels(out)).toEqual(["P1", "P2", "P3"]);
    expect(await fieldNames(out)).toEqual(["texto_1", "acepto", "texto_2", "texto_3"]);
    expect((await openPdf(out)).getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 180]);
  });
});

describe("writeMetadata: XMP", () => {
  const XMP = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" pdf:Keywords="viejo, antiguo" xmp:CreatorTool="Word" xmp:ModifyDate="2020-01-01T00:00:00Z" xmpRights:Marked="True">
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">Título viejo</rdf:li></rdf:Alt></dc:title>
<dc:creator><rdf:Seq><rdf:li>Autor viejo</rdf:li></rdf:Seq></dc:creator>
<dc:description><rdf:Alt><rdf:li xml:lang="x-default">Asunto viejo</rdf:li></rdf:Alt></dc:description>
</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;

  async function withXmp(): Promise<Uint8Array> {
    const doc = await openPdf(await makePdf({ meta: { title: "Título viejo" } }));
    const ref = doc.context.register(doc.context.stream(new TextEncoder().encode(XMP), { Type: "Metadata", Subtype: "XML" }));
    doc.catalog.set(PDFName.of("Metadata"), ref);
    return doc.save();
  }
  async function xmpOf(bytes: Uint8Array): Promise<string> {
    const doc = await openPdf(bytes);
    const stream = doc.context.lookup(doc.catalog.get(PDFName.of("Metadata")));
    if (!(stream instanceof PDFRawStream)) throw new Error("no XMP stream");
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }

  it("keeps the XMP packet in step with the Info dictionary", async () => {
    const out = await writeMetadata(await withXmp(), {
      title: "Nuevo <título> & más",
      author: "Autora Nueva",
      subject: "Asunto nuevo",
      keywords: "uno, dos",
      creator: "snow",
    });
    const xmp = await xmpOf(out);
    expect(xmp).toContain('<rdf:li xml:lang="x-default">Nuevo &lt;título&gt; &amp; más</rdf:li>');
    expect(xmp).toContain("<rdf:li>Autora Nueva</rdf:li>");
    expect(xmp).toContain("Asunto nuevo");
    expect(xmp).toContain('pdf:Keywords="uno, dos"');
    expect(xmp).toContain('xmp:CreatorTool="snow"');
    expect(xmp).not.toMatch(/viejo|Word|2020-01-01/);
    expect(xmp).toContain('xmpRights:Marked="True"'); // everything else is untouched
    expect(xmp.startsWith("<?xpacket")).toBe(true);
    expect((await readMetadata(out)).title).toBe("Nuevo <título> & más");
  });

  it("removes a property from XMP when it is cleared, and leaves it alone when not mentioned", async () => {
    const xmp = await xmpOf(await writeMetadata(await withXmp(), { author: "", keywords: "" }));
    expect(xmp).not.toContain("dc:creator");
    expect(xmp).not.toContain("pdf:Keywords");
    expect(xmp).toContain("Título viejo");
    expect(xmp).toContain('xmp:CreatorTool="Word"');
  });

  it("leaves the packet byte for byte alone when nothing it holds changes", async () => {
    const out = await writeMetadata(await withXmp(), {});
    expect(await xmpOf(out)).toBe(XMP);
  });
});
