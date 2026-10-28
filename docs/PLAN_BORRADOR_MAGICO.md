# Plan de SnowPDF: borrador mágico

Diseño de octubre de 2026. Herramienta para **borrar texto (y otros elementos pequeños)
dejando a la vista el fondo real**, aunque no sea blanco: degradados, cajas de color, fotos,
papel escaneado.

## 1. Idea clave

En un PDF nacido digital el texto es una capa encima del fondo. Si se eliminan los glifos, el
fondo **ya está ahí debajo**: no hay que inventar nada. Esto ya lo hace la exportación de
"editar texto" (`RedactionArea.mode = "replace"`), pero:

- la **vista previa** tapa la línea con un rectángulo de color plano (`Underlay.tsx`), así que
  en fondos no blancos se ve mal mientras editas;
- el **corrector** (`whiteout`) solo pinta un rectángulo plano encima;
- en un PDF **escaneado** el texto son píxeles de una imagen: quitar glifos no hace nada.

El borrador mágico prueba de menos a más agresivo y se queda con el primer método que deja la
zona limpia:

| Método | Qué se elimina (MuPDF `applyRedactions`) | Cuándo basta |
|---|---|---|
| `text` | glifos (`TEXT_REMOVE`, `IMAGE_NONE`, `LINE_ART_NONE`) | texto normal sobre cualquier fondo |
| `vector` | glifos + trazados totalmente dentro (`LINE_ART_REMOVE_IF_COVERED`) | texto convertido a curvas, subrayados, iconos vectoriales |
| `pixels` | lo anterior + píxeles de imagen (`IMAGE_PIXELS`) y **parche reconstruido** encima | texto dentro de una imagen (escaneados, capturas) |

"Zona limpia" se decide **renderizando** la zona después de quitar y midiendo si queda tinta.
Así no hace falta saber de antemano cómo está construido el PDF (sirve también para PDFs con
OCR, donde el texto real es invisible y lo visible son píxeles).

En `text` y `vector` el resultado exportado es el fondo vectorial original, nítido a cualquier
zoom. Solo en `pixels` se dibuja una imagen reconstruida (inpainting) encima.

## 2. Modelo (`src/model/types.ts`)

Nuevo `ObjectKind` `"erase"`:

```ts
export type EraseMethod = "text" | "vector" | "pixels" | "none";

/** Magic eraser: removes the content inside the frame and shows the real background. */
export interface EraseObject extends ObjectBase {
  kind: "erase";
  /** Chosen by analysis; null while it is being analysed. "none" = nothing to erase. */
  method: EraseMethod | null;
  /**
   * Render of `renderBox` after erasing (ImageAsset id). Shown on screen for every method;
   * exported only for "pixels" (the reconstructed patch).
   */
  assetId: string | null;
  /** User-space box the asset covers: the frame's bbox grown by 1 pt. */
  renderBox: PdfBox | null;
}
```

- `frame` como en `redact` (se usa `frameBBox(frame)`), `opacity` siempre 1.
- No se puede rotar (sin asa de rotación). Mover o redimensionar **invalida** el análisis:
  `method = null`, `assetId = null`, `renderBox = null`, y se vuelve a analizar.

## 3. Motor

### 3.1 `src/pdf/inpaint.ts` (nuevo, TypeScript puro, sin DOM, testeable en Node)

Trabaja sobre buffers RGB/RGBA (`Uint8ClampedArray`, ancho, alto).

1. **`inkMask(img, opts)`** → `Uint8Array` (1 = tinta).
   - Luminancia; polaridad (texto oscuro sobre claro o al revés) comparando la mediana del
     borde de la zona con la del interior, como hace `sampleColors` en `editText.ts`.
   - Estimación del fondo con **cierre morfológico** en escala de grises (máximo y luego
     mínimo, separables, radio ≈ grosor máximo de trazo: `max(2, round(dpi * 0.04))` px); para
     texto claro sobre oscuro, apertura.
   - Tinta = `|gris − fondo| > umbral` (umbral 24 por defecto; configurable).
   - **Filtro de componentes conexas** (4-conectividad): descartar componentes que toquen dos
     bordes opuestos de la zona o que toquen un borde y tengan relación de aspecto > 8. Son
     líneas de tabla o bordes de cajas que cruzan la zona y **no** deben borrarse.
   - Dilatar 1-2 px la máscara final (halos de antialiasing).
2. **`inpaint(img, mask, opts)`** → imagen nueva.
   - Relleno **push-pull** (pirámide): bajar de resolución promediando solo píxeles no
     enmascarados hasta que no queden huecos; subir interpolando y rellenando solo los
     enmascarados.
   - **Grano**: medir la desviación típica del ruido en los píxeles no enmascarados cercanos
     y añadir ruido gaussiano de esa amplitud a los rellenados, con un PRNG **con semilla
     fija** (resultado determinista y testeable). Hace que el papel escaneado no se vea
     "plastificado".
   - Solo se modifican los píxeles de la máscara; el resto queda idéntico.

### 3.2 `src/pdf/mupdf/ops.ts`

**Renderizar una región.** Nueva función interna `renderRegion(page, box, dpi)`: usar
`toPageRect(page.getTransform(), box)` (ya existe) escalado por `dpi / 72`, redondeado hacia
fuera a píxeles enteros; `Pixmap` RGB sin alfa de ese bbox, `clear(255)`, `DrawDevice` y
**`page.runPageContents`** (no `run`: las anotaciones y widgets los pinta pdf.js encima).
Comprobar las firmas exactas en `node_modules/mupdf/dist/mupdf.d.ts` antes de usarlas.

**Nueva operación `eraseRegion`:**

```ts
export interface EraseRegionResult {
  method: EraseMethod;
  /** PNG of `box` after erasing. */
  png: Uint8Array;
  width: number;
  height: number;
  /** User-space box rendered: the requested box grown by 1 pt. */
  box: PdfBox;
}

export function eraseRegion(
  bytes: Uint8Array,
  pageIndex: number,
  box: PdfBox,
  opts?: { maxMethod?: EraseMethod },   // "text" for the edit-text preview
): EraseRegionResult
```

Algoritmo:

1. `renderBox = grow(box, 1)`. DPI: 150 para el análisis; si la zona supera ~4 Mpx, bajarlo.
2. Renderizar `before`. Calcular `inkMask` dentro de `box` (no en el margen). Si no hay tinta
   → `method: "none"`, PNG = `before`.
3. Para cada método en orden (`text`, `vector`, hasta `maxMethod`): **abrir el documento de
   nuevo desde `bytes`** (applyRedactions modifica el documento), crear la anotación Redact
   en `box`, `applyRedactions(false, …)` con las opciones de la tabla, renderizar `after`,
   calcular tinta residual. Si `tinta residual < max(15 px, 3 % de la tinta inicial)` → usar
   ese método y devolver `after`.
4. Si ninguno basta (y `maxMethod` lo permite): `pixels`. Rehacer con DPI de parche
   `min(300, lo que quepa en ~4 Mpx)` el render tras `vector`, `inkMask` + `inpaint`, y
   devolver ese PNG.
5. Liberar todo (`destroy`) en `finally`, como el resto del archivo.

Registrarla en `workerOps`: `eraseRegion: (a: { bytes; pageIndex; box; maxMethod? }) => …`.

**`redact()`:** ampliar `RedactionArea["mode"]` con `"erase-vector"` y `"erase-pixels"`, cada
uno en su propia pasada:

| mode | image | lineArt |
|---|---|---|
| `replace` (sin cambios) | NONE | NONE |
| `erase-vector` | NONE | REMOVE_IF_COVERED |
| `erase-pixels` | PIXELS | REMOVE_IF_COVERED |
| `redact` (sin cambios) | PIXELS | REMOVE_IF_COVERED |

(`erase-pixels` coincide con `redact`; se mantiene separado por claridad y por si cambian.)

### 3.3 `src/pdf/compose.ts` y `bake.ts`

- Paso 3 de `compose`: para cada `erase` con `method` `text` → `replace`; `vector` →
  `erase-vector`; `pixels` → `erase-pixels`; `none`/`null` → nada. Caja = `frameBBox(frame)`.
- `bake.ts`: `case "erase"`: solo si `method === "pixels"`, dibujar `assetId` en `renderBox`
  (el parche cubre el margen de 1 pt y tapa los píxeles que MuPDF haya rellenado).
- La exportación **nunca** analiza: usa el `method` guardado. Antes de guardar hay que esperar
  a que terminen los análisis pendientes (ver 4.3).

## 4. Interfaz

### 4.1 Herramienta

- `EditorTool` `"erase"`, en la barra junto al corrector: **"Borrador mágico"**, atajo **B**
  (comprobar que no está usado). Icono `lucide-react`: `WandSparkles` o `Wand2` (comprobar
  en `lucide-react.d.ts`).
- Arrastrar → rectángulo (como `whiteout`, en `RECT_TOOLS` y `STICKY`).
- Clic sin arrastrar sobre una línea de texto → borra esa línea (caja de la línea crecida
  0,4 pt, igual que `createReplacement`). Reutilizar la detección de líneas de "editar texto".
- Tooltip / ayuda corta: "Borra texto y deja ver el fondo original".

### 4.2 Vista

- `Underlay.tsx`: para `erase` con `assetId`, `<img>` del asset en `renderBox`, sin
  suavizado raro (`image-rendering` por defecto). Mientras `method === null`: overlay
  sutil animado (por ejemplo, rayado suave con `animate-pulse`), nunca un bloque blanco.
- `ObjectView`: solo el contorno al seleccionar; etiqueta "Borrado".
- `PropertiesPanel`: mostrar el método en lenguaje llano:
  - `text`/`vector`: "Se ha quitado el texto; se ve el fondo original."
  - `pixels`: "El texto era parte de una imagen: el fondo se ha reconstruido."
  - `none`: "No hay nada que borrar en esta zona."

### 4.3 Servicio de análisis (`src/features/editor/erase.ts`, nuevo)

- `analyseErase(obj)`: obtiene `PageRef` → `getSource(sourceId).bytes` y `sourceIndex`
  (páginas en blanco, `sourceId === null`: `method: "none"`), llama a
  `callMupdf("eraseRegion", …)`, guarda el PNG con `putAsset` y parchea el objeto.
- **El parcheo del resultado no debe crear un paso de deshacer propio**: revisar cómo
  `editorStore`/`docStore` agrupan cambios (p. ej. la clave de coalescencia de
  `patchObject`) y fusionarlo con la creación o con el último movimiento.
- Resultados obsoletos: guardar un token (frame serializado) al lanzar; descartar si el
  objeto ya no existe o su frame cambió.
- Disparo: al crear el objeto y tras mover/redimensionar (con *debounce* ~250 ms).
- Al deshacer/rehacer los objetos vuelven con su `assetId` (los assets siguen en el
  registro de la pestaña): no hace falta reanalizar.
- `whenErasesSettled(): Promise<void>` y llamarlo en `save.ts` antes de componer.

### 4.4 "Editar texto" (segunda fase, mismo motor)

Sustituir el rectángulo plano de `Underlay.tsx` para `text.replaces` por el render tras
quitar el texto: `eraseRegion(…, { maxMethod: "text" })` por cada caja, con una caché a nivel
de módulo `Map<clave, Promise<url>>` (clave = sourceId + página + caja redondeada). Mientras
llega, se mantiene el color plano actual. No cambia el modelo ni la exportación.

## 5. Tests (`tests/`)

- `inpaint.test.ts`: degradado + trazos negros → error medio en la máscara < 6 niveles;
  fondo plano con ruido → desviación típica del relleno parecida a la del fondo; texto claro
  sobre oscuro; línea que cruza toda la zona **no** entra en la máscara; determinismo.
- `erase.test.ts` (MuPDF, fixtures con pdf-lib en `helpers.ts`):
  1. texto sobre rectángulo de color → `method: "text"`, el centro del PNG ≈ color del
     rectángulo;
  2. "texto" dibujado como trazado (`drawSvgPath`) → `"vector"`;
  3. texto dentro de una imagen (renderizar con MuPDF una página con texto a PNG e
     incrustarlo con pdf-lib) sobre fondo de color → `"pixels"`, píxeles de la zona ≈ fondo;
  4. zona vacía → `"none"`.
- `compose`: exportar con `erase` `text` → MuPDF ya no extrae la palabra y el render conserva
  el color del rectángulo; con `pixels` → render ≈ fondo y **tamaño de salida** medido.

## 6. Riesgos conocidos

- **Tamaño del archivo con `IMAGE_PIXELS` (resuelto):** MuPDF reescribe la imagen JPEG
  escaneada sin pérdida (Flate) y el archivo crecía ×7-8, también con "Redactar". `redact()`
  ahora vuelve a codificar como JPEG (calidad 90, solo si ocupa menos) las imágenes que eran
  DCT antes de la pasada, con el helper `rewriteAsJpeg` compartido con `compress()`. El parche
  de `pixels` se guarda como JPEG. Medido con un escaneado A4 de 1496×2117: "Redactar" ×1,23,
  borrador exportado ×1,27 (los tests lo vigilan con < 1,5 y < 1,35).
- **Heurística de componentes:** una letra cortada por el borde del rectángulo toca un borde;
  solo se descarta si además es alargada o toca dos bordes opuestos.
- **`REMOVE_IF_COVERED` en `vector`:** si la zona contiene entera una celda de color, la celda
  desaparece. Se acepta: es lo que el usuario ha seleccionado.
- **Rendimiento:** cada análisis copia los bytes del PDF al worker y lo vuelve a abrir.
  Aceptable para la primera versión; si hace falta, caché del documento en el worker.
- Las firmas exactas de la API de mupdf.js (`Pixmap`, `DrawDevice`, `runPageContents`) se
  comprueban en el `.d.ts`; no suponerlas.
