# SnowPDF: gaps against open source alternatives

Analysis from October 2026. Compares SnowPDF with the strongest open source alternatives to
Acrobat: **Stirling-PDF** (toolbox, Java/Docker server), **PDF Arranger** (organize pages),
**Okular** and **Xournal++** (annotate), **LibreOffice Draw** (edit text), and **PDF4QT**
(full editor). Lists where they are ahead and what it would take to close the gap.

SnowPDF strengths worth keeping: everything in one desktop app, fully local with no server,
real redaction, text editing that reuses the document's own font, export that reuses the
original PDF objects, and a modern interface with dark mode.

## High priority

### 1. OCR
- **Status:** none; Stirling-PDF has it (OCRmyPDF + Tesseract).
- **Why it is hard:** with no server, the engine (tesseract.js/WASM) and language models have
  to ship inside the app.
- **Proposal:** tesseract.js with bundled `spa` and `eng`; an invisible text layer under the
  image so a scanned PDF becomes searchable and selectable.

### 2. Certificate based digital signatures (PAdES) and signature validation
- **Status:** only visual signatures exist (drawing, text, or image). Okular and PDF4QT verify
  signatures; LibreOffice signs with a certificate.
- **Why it matters:** many official procedures require it, and it is one of the main reasons
  people still pay for Acrobat.
- **Proposal:** sign with a `.p12`/`.pfx` certificate (and, on Windows, from the certificate
  store, which includes government eID certificates), and show the status of existing
  signatures.

### 3. Standard PDF annotations
- **Status:** `bake.ts` draws highlights, shapes, freehand ink, and notes into the page
  content. In another reader they can no longer be edited, moved, or commented on. Okular and
  Xournal++ store standard annotations.
- **Proposal:** export highlights, shapes, ink, and notes as annotations (`/Highlight`,
  `/Square`, `/Ink`, `/Text`...), keeping the current behaviour as a "Flatten" option.
- **Related gap:** links can be neither edited (URL/destination) nor created or removed; edited
  text only carries along the links it already had.

## Medium priority

### 4. PDF/A
- **Status:** cannot be generated or validated. Some government portals require it.
- **Proposal:** conversion to PDF/A-2b (embedded fonts, output colour profile, no encryption)
  and basic validation of the result.

### 5. Robustness with difficult PDFs
- **Status:** the alternatives have years of bug reports from real world PDFs. Editing text
  with the original font is the most fragile part (see `PLAN_FUENTES_ORIGINALES.md`).
- **Proposal:** a corpus of problematic real PDFs (font subsets missing glyphs, scans, XFA,
  hundreds of pages, files produced by Word, LaTeX, or scanners) with regression tests.

### 6. Performance with large documents
- **Status:** pdf.js and MuPDF WASM inside a WebView use more memory and are slower than
  native MuPDF or Poppler (Okular, Sumatra, PDF4QT).
- **Proposal:** measure with 1000+ page documents; lazy rendering and thumbnails, releasing
  off screen pages, and consider moving heavy operations to the Rust side.

### 7. Forms with calculations
- **Status:** form scripts do not run; automatic sums and validations do not work.
- **Proposal:** support only Acrobat's standard calculation functions (`AFSimple_Calculate`,
  `AFNumber_Format`, `AFDate_Format`...) without running arbitrary JavaScript, for safety.

### 8. Conversions
- **Status:** no PDF to text or to Word/Excel; Stirling-PDF has both.
- **Proposal:** PDF to text first (pdf.js already extracts text); Office conversion using a
  local LibreOffice install when available (already planned for roadmap v0.3).

### 9. Compare PDFs
- **Status:** planned, not implemented.
- **Proposal:** per page text diffing plus an overlaid visual comparison.

## Low priority

### 10. Cross platform support
- **Status:** Windows only. Stirling-PDF, Okular, and PDF Arranger run everywhere.
- **Proposal:** macOS and Linux with Tauri (needs a review of dialogs, file association, and
  the installer), then mobile.

### 11. Accessibility (tagged PDF and PDF/UA)
- **Status:** no tagged structure is generated, and editing does not add new content to an
  existing structure, so SnowPDF can break the accessibility of a PDF that already had it.
- **Proposal:** at minimum, stop breaking existing structure; add new text to it.

### 12. Print production
- Print preflight and colour separation views. A very specialised niche; not a priority.

## Non technical risks
- **A single developer with no community:** affects long term maintenance and third party
  trust.
- **Licensing:** MuPDF is AGPL-3.0, which constrains how SnowPDF can be distributed.
