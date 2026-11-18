# SnowPDF architecture

Desktop PDF editor and toolkit (Windows first, Android/iOS later) that runs **100% locally**:
no document ever leaves the machine. No server, no analytics, no runtime network calls.

## 1. Stack

| Layer | Technology | Why |
|---|---|---|
| Native shell | **Tauri 2** (Rust) | Small binary, uses WebView2; the same project builds for Android/iOS. |
| UI | **React 19 + TypeScript + Vite 8 + Tailwind 4** | Productivity and portability (desktop and mobile share the UI). |
| Rendering and text | **pdfjs-dist 6** (Mozilla) | Faithful rendering, text layer (selection, search), form layer. |
| PDF writing | **@cantoo/pdf-lib 2** (maintained pdf-lib fork) | Composing, merging, splitting, drawing edits, forms, AES-256 encryption. |
| Heavy operations | **mupdf 1.28 (WASM, in a Web Worker)** | Real redaction, compression, repair, unlocking, rasterising. |
| State | zustand + immer | A simple store with snapshot based undo/redo. |
| Icons | lucide-react | |
| ZIP | fflate | Exporting several files in the browser. |
| Drag and drop | @dnd-kit | Reordering pages/files (touch friendly too). |

> License note: MuPDF is **AGPL-3.0**. Fine for personal use; if SnowPDF is ever distributed as
> closed source, it would need to be replaced or licensed from Artifex.

## 2. Folder structure (and who owns what)

```
src/
  main.tsx, App.tsx        Startup, state based routing (useAppStore.view). While the code
                           loads, index.html shows its own loading screen (inline CSS and
                           SVG, nothing else has loaded yet); it fades once #root has content
  styles.css               Tailwind + design tokens + page layer styles
  model/                   Document types, stores (zustand), history, registries
  platform/                File I/O abstraction: Tauri (native dialogs) / browser
  pdf/                     PDF engine WITHOUT React (testable in Node with vitest)
    pdfjs.ts               pdf.js and worker loading
    pageGeometry.ts         Drawing in "screen" coordinates over rotated pages
    compose.ts, bake.ts    Exporting the edited document
    ranges.ts              Parser for "1-3, 5, 8-" style ranges
    tools/                 One off operations (merge, split, watermark, page numbers...)
    mupdf/                 MuPDF worker + RPC client (redact, compress, protect...)
    scan/                  Document scanner: find the sheet, straighten it, filters
  render/                  Render queue, thumbnails
  ui/                      Reusable component kit (no business logic)
  features/
    home/                  Home screen with the tool catalogue
    editor/                Acrobat style viewer/editor
    organize/              Organize pages (drag and drop grid)
    tools/                 iLovePDF style batch tool pages
    signature/              Create/save signatures
    scan/                  Phone scanner: camera photos -> cropped, cleaned pages -> PDF
tests/                     vitest (Node) for src/pdf/**
src-tauri/                 Rust shell (dialog + fs + opener plugins, .pdf file association)
```

## 3. Document model (`src/model/types.ts`)

- **SourceInfo**: each opened PDF. The bytes and pdf.js's `PDFDocumentProxy` live in a registry
  outside the store (not serialisable). An encrypted PDF is decrypted on open (MuPDF) and the
  app always works on cleartext bytes; it can be re-encrypted on save.
- **PageRef**: a page of the working document = (source, index, extra rotation, crop).
  Organizing (reordering, rotating, deleting, duplicating, inserting from another PDF, blank
  pages) only changes this list: it is instant and never rewrites the PDF until export.
- **EditorObject**: overlaid edits (text, image, signature, shapes, ink, highlight, whiteout,
  redaction, symbols: check, cross, dot). Stored per `pageId` with a `Frame`.
- **DocState** = `{ pages, objects }` is what goes into the undo/redo history.
- AcroForm field values live in pdf.js's `annotationStorage` (per source).

### Coordinates

All geometry is stored in **PDF user space** (points, origin bottom left, y up, ignoring page
rotation). `Frame = {cx, cy, w, h, rot}` with `rot` in counter clockwise degrees. An object
created on a page displayed with rotation R gets `rot = R` so it looks upright. Rotating a page
therefore rotates its objects with it.

Screen to PDF conversion uses pdf.js's `PageViewport`
(`convertToViewportPoint` / `convertToPdfPoint`). An object's on screen CSS rotation is
`R - rot` (clockwise).

## 4. Export (`src/pdf/compose.ts`)

1. For each source with modified form fields: pdf.js's `pdf.saveDocument()`.
2. pdf-lib loads the base source (the one the first page comes from) and **reuses its page
   objects** (keeps forms, links, metadata); copies pages from other sources and merges their
   form fields; applies rotations, crops, and blank pages.
3. If there are redactions or "edit text" replacements: MuPDF really removes the content under
   those areas. In the editor, such edited texts behave as page content in every tool except
   "Edit text" (no selection frame, clicks fall through to links and page text); only that tool
   edits, moves (drag) or removes them (right-click menu).
4. pdf-lib draws the editor objects (text, images, shapes...) into each page's content.
5. Optional: flatten the form, strip metadata, prune orphan objects, encrypt.

### Scanner (`src/pdf/scan/`, `src/features/scan/`)

Photos become pages in three pure steps on plain pixel buffers (no OpenCV, no DOM, tested in
Node):

1. `detect.ts` proposes the sheet's corners: text erased with a morphological closing, Sobel
   edges, a Hough transform, then every quadrilateral the strongest lines form, scored by how
   much edge lies under its outline (the pipeline Dropbox describes for its scanner). A wrong
   outline costs more than none (the crop would eat part of the page), so a candidate must also
   look like paper lying on something: no side darker inside than outside, and the sides
   lighter inside than what lies beyond them, near and further out. That rejects what is
   printed on the sheet (a table with filled rows, a picture, a box) when the sheet fills the
   photo. The photo's own border may stand in for one side, for sheets with an edge out of the
   picture; with less to go by there is no proposal and the outline is the whole photo.
2. `warp.ts` straightens that quadrilateral with a homography. The crop is taken a hair inside
   the outline (to keep the table out), except where the outline is on the photo's border.
3. `enhance.ts` applies the filter. A photo is "what is printed" times "how much light falls
   there": the light is measured on a coarse grid (about a millimetre of an A4 per cell) and a
   morphological closing several millimetres wide erases the text from it, however blurry, while
   keeping the edges of shadows in place. What is left and is not paper (another colour than the
   paper's, or far darker than the page around it) is print and takes its light from the paper
   next to it. Dividing by that light removes shadows and the lamp's tint without washing out
   logos, stamps, photos or coloured boxes. The paper's noise and the ink's darkness are then
   measured on the result: noisy photos are smoothed and get a lower white point, faint grey ink
   (out of focus, pencil) a higher black point. Strokes are reinforced with an unsharp mask and a
   tone curve takes paper to white and ink to dark; "Color", "Grises" and "B/N" differ only in
   that last step. Every size is relative to the sheet, so the screen copy and the PDF page look
   the same. The tests include a photo out of focus, dark and noisy: that is what a phone gives
   indoors, and a light map finer than the text divides the text away on it.

The screen works on a reduced copy of each photo; the PDF is made from the original at full
quality (`scanActions.ts`) and opens in the editor as an unsaved document.

Nothing is ever cut off a photo: a page is the whole photo plus an outline, and the outline is
set on the corners screen (`CropEditor.tsx`), which always shows the whole photo. That screen
comes right after each photo with the automatic proposal, and again from the review, either
with its "Ajustar bordes" button or by going back (`scanBack`): back from the review leads to
the corners, and back from there leaves the scan.

The camera is the scanner's own (`camera.ts`, `CameraView.tsx`), in two parts. The live view is
a modest `getUserMedia` video (1440×1080, at a size the camera has natively): the Android
WebView copies every frame through the CPU, so a 4K view stutters. The photo is a still taken
through the same track with `ImageCapture.takePhoto` at the camera's photo resolution (capped
at 4096 px): the camera stops the video for about a second and shoots a real photo, far sharper
and cleaner than a video frame. The frame on screen is grabbed first and is the photo if a still
cannot be taken, fails, takes too long or comes out smaller. Either way the light can stay on
while aiming (the track's `torch` constraint) and the photo is the way it was on screen (the
system camera app picks "up" from the tilt sensor, which is lost with the phone flat over a
sheet). On Android it needs the `CAMERA` permission, which the WebView requests on first use. If
the camera cannot be opened, the screen offers the system camera app (`platform.capturePhoto`,
through the WebView's file chooser) and the photo picker instead.

## 5. Code conventions

- Strict TypeScript. Function components. **Named exports** (no `default`).
- Import with the `@/` alias (= `src/`).
- **Code and comments in English; UI strings in Spanish** (informal "tu", short sentences).
- Styling only with Tailwind using the **semantic tokens**: `bg-app`, `bg-surface`,
  `bg-surface-2`, `bg-surface-3`, `text-fg`, `text-muted`, `text-subtle`, `border-line`,
  `border-line-strong`, `bg-canvas`, and the `brand-50...950` palette. Always support dark mode
  (tokens already switch on their own; raw colours need a `dark:` variant).
- The look is ink, white and one accent (vermilion, the `brand` palette), flat, with hairlines and
  nearly square corners. A filled main action is `bg-primary text-on-primary hover:bg-primary-hover`
  (ink on light, vermilion on dark); an active toggle is the inverted tile `bg-fg text-surface`;
  the frame (header, side panels) is drawn with `border-rule`; anything on a `bg-brand-500` fill is
  `text-ink`, never white. Vermilion is kept for the mark (`BrandMark`), focus rings, selection and
  "current" indicators and the unsaved dot. Tool icons are monochrome (`text-fg`).
- Two fonts ship with the app (`src/assets/fonts`, SIL OFL): Instrument Sans for the interface
  (`font-sans`) and Bricolage Grotesque for headings and the logotype (`font-display`; `h1` and
  `h2` use it by default).
- Icons from `lucide-react` (check the name exists in
  `node_modules/lucide-react/dist/lucide-react.d.ts`). The theme setting has its own icons
  (`ThemeLightIcon`, `ThemeDarkIcon`, `ThemeSystemIcon` in `src/ui/themeIcons.ts`), built with
  `createLucideIcon` on the same 24 px grid so they go wherever a `LucideIcon` does.
- Bytes are always `Uint8Array`. Colours are `"#rrggbb"` strings.
- `src/pdf/**` must not import React or touch the DOM (it has to run in Node for the tests),
  except files that say otherwise.
- Do not add new dependencies without agreeing on it first.
- Verification: `npm run typecheck`, `npm test`, `npm run build`.

## 6. UI kit (`src/ui/`)

Every component is imported from `@/ui` (barrel at `src/ui/index.ts`). See each file for its
types; in short:

`Button`, `IconButton`, `Modal`, `Menu`, `Popover`, `Tooltip`, `Slider`, `NumberField`,
`TextField`, `Select`, `Switch`, `Checkbox`, `SegmentedControl`, `ColorPicker`, `Tabs`,
`Spinner`, `ProgressBar`, `Dropzone`, `Badge`, `Kbd`, `EmptyState`,
`Toaster` + `toast.success/error/info`, `DialogHost` + `confirmDialog()` / `promptDialog()`.

## 7. Roadmap

- **v0.1** (this version): viewer, editor (text, edit existing text, images, signatures,
  shapes, drawing, highlight, whiteout, magic eraser, real redaction, symbols), forms,
  organize pages, merge, split, compress, rotate, images to/from PDF, watermark, page
  numbering, protect/unlock, metadata, crop, repair.
- **v0.2**: multi document tabs, OCR (tesseract.js with bundled languages), compare PDFs,
  notes/comments as annotations, links (edit a link's target URL/destination, create and
  remove links; today existing links only follow the text that carries them), bookmarks.
- **v0.3**: PDF to Word/Excel, Office to PDF (local LibreOffice if installed), PDF/A.
- **Mobile**: `tauri android init` / `tauri ios init`; the UI already uses pointer events.

Gaps against open source alternatives, with their priority, are tracked in `ALTERNATIVES.md`.
