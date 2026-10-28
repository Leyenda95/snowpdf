# Plan de SnowPDF: usar la fuente original al «Editar texto»

> **Estado (27/10/2026):** implementados el paso 0, las fases 1 a 6 y el paso 17 (líneas
> justificadas). Pendientes: pasos 14, 15, 16 y 18.
> Los datos de pdf.js están comprobados en `pdfjs-dist` 6.4.299, la versión instalada.
>
> Notas de la implementación:
> - `embedFont(..., { subset: true })` falla con `@cantoo/pdf-lib` + `@pdf-lib/fontkit`
>   (`TTFSubset.encode`); la exportación usa `subset: false`, que funciona.
> - pdf.js no siempre mete el espacio en la `cmap` convertida: los espacios usan entonces la
>   fuente de respaldo, igual en pantalla y en el PDF.
> - `font.bold` puede llegar sin definir; la negrita se detecta también por el nombre, que ahora
>   sí llega.
> - Justificado: `TextObject.justifyWidth` guarda el ancho original de la línea y el espacio
>   extra se reparte entre los espacios (máximo 1,5 veces el tamaño por espacio). Al exportar,
>   cada palabra se coloca por separado, porque `Tw` no funciona con fuentes de dos bytes.

## 1. Objetivo

Al editar una línea de un PDF, el texto nuevo debe verse y guardarse con **la misma fuente
del documento**. Si una letra no está en esa fuente, solo esa letra usa la fuente parecida
que se usa hoy (Helvetica, Times o Courier).

Lo que verá el usuario:

- Hace clic en una línea con «Editar texto» y el cuadro aparece con la fuente original (por
  ejemplo Calibri), con el mismo tamaño, color y posición.
- En el panel, «Fuente» muestra «Calibri (del documento)». Puede cambiar a una estándar y
  volver a la original.
- Si escribe letras que el PDF no trae, el panel lo dice: «La fuente original no incluye:
  «ñ», «Q». Esas letras usan Helvetica.»
- Si la fuente no se puede reutilizar, todo funciona como ahora.

## 2. Punto de partida

- `createReplacement` (`src/features/editor/overlay/editText.ts`) crea un `TextObject` con
  `font` = `helvetica | times | courier`, elegida por `guessFont`.
- Medidas: `src/pdf/textLayout.ts` usa las métricas AFM de las 14 fuentes estándar. La
  pantalla (`ObjectView`, `TextEditor`) usa Arial, Times New Roman y Courier New, que tienen
  las mismas métricas.
- Al guardar, `compose.ts` borra con MuPDF el texto original bajo `replaces`, y `bake.ts`
  dibuja el nuevo con `embedStandardFont`.
- `@pdf-lib/fontkit` ya está en `package.json`, aunque no se usa: no hace falta añadir
  dependencias.
- **Fallo actual encontrado:** `guessFont` lee `name` del objeto fuente de pdf.js. En pdf.js 6
  ese campo solo llega con `fontExtraProperties: true`, y `src/render/pdfjs.ts` no lo activa.
  Por eso hoy nunca se detectan la negrita ni la cursiva del original, y la familia solo se
  decide por `line.family`. Se arregla en el paso 0.

## 3. Decisión: de dónde sacar la fuente

| Opción | Ventajas | Problemas | |
|---|---|---|---|
| A. Reutilizar el objeto fuente del PDF original y escribir con sus códigos de carácter | Fidelidad total; no duplica la fuente | MuPDF reescribe el contenido al redactar y puede quitar la fuente de `/Resources` si esa línea era su único uso. Hay que invertir la codificación (ToUnicode, Differences, CMaps CID): complejo y frágil. pdf.js 6 no envía `toUnicode` al hilo principal, ni siquiera con `fontExtraProperties`. | Descartada |
| B. Extraer el fichero de fuente con MuPDF | No depende de pdf.js | Ni el navegador ni fontkit aceptan Type1 (PFB) ni CFF suelto, y los TrueType recortados suelen venir sin cmap Unicode. Habría que rehacer la conversión que ya hace pdf.js. | Descartada |
| C. Usar la conversión que ya hace pdf.js (`font.data`) | Un único formato (OpenType) que sirve para la pantalla (`FontFace`) y para guardar (fontkit + pdf-lib) | Hay que activar `fontExtraProperties` (más memoria) | **Elegida** |

Hechos comprobados en `node_modules/pdfjs-dist/build/pdf.worker.mjs` y `pdf.mjs`:

- pdf.js convierte toda fuente incrustada (Type1, CFF, TrueType, OpenType, CID) a OpenType
  para el navegador.
- Su tabla `cmap` incluye **Unicode → glifo** (`adjustMapping` → `toUnicodeExtraMap` →
  `createCmapTable`), tanto en la ruta TrueType como en la Type1/CFF, además de los códigos
  de uso privado que usa internamente.
- Solo conserva las tablas `OS/2, cmap, head, hhea, hmtx, maxp, name, post, loca, glyf, fpgm,
  prep, cvt, CFF` (`VALID_TABLES`). Sin `GSUB`, `GPOS` ni `kern` no hay ligaduras ni kerning
  que descuadren las medidas.
- Tras cargar la fuente, pdf.js borra `font.data` (`FontFaceObject.clearData`) salvo con
  `fontExtraProperties: true`. Con esa opción también llega `name`
  (`EXPORT_DATA_EXTRA_PROPERTIES`).

Son detalles internos de pdf.js, no API documentada: el test de integración del paso 12
avisará si cambian al actualizar pdf.js.

## 4. Arquitectura

Idea central: cada texto tiene una **cadena de fuentes**, `[fuente original, fuente estándar]`.
Cada carácter usa la primera fuente de la cadena que lo tenga. El navegador hace lo mismo con
`font-family`, letra a letra, así que la pantalla y el PDF guardado deciden igual. Más
adelante se puede añadir un eslabón intermedio (la fuente instalada en Windows, paso 14) sin
cambiar nada más.

```
Clic en una línea («Editar texto»)
 └─ createReplacement
     ├─ guessFont ............. respaldo: helvetica/times/courier + negrita/cursiva
     └─ resolveSourceFont ..... src/render/sourceFonts.ts
         ├─ commonObjs.get(fontName) → font.data (OpenType de pdf.js)
         ├─ filtros: Type3, no incrustada, vertical, cobertura, glifos vacíos, escala
         └─ registry.putFont ... bytes + FontFace (pantalla) + fontkit (medidas)

TextObject { sourceFont: id, useSourceFont: true, font/bold/italic = respaldo }
 ├─ Pantalla: font-family: "snow-font-<id>", Helvetica, Arial, …  (el navegador cae letra a letra)
 ├─ Medidas:  textLayout con la cadena → tramos por fuente → mismo ancho y línea base
 └─ Guardar:  Baker incrusta la fuente (pdf-lib + fontkit) y dibuja cada tramo con la suya
```

### Archivos

| Archivo | Cambio |
|---|---|
| `src/render/pdfjs.ts` | `fontExtraProperties: true` |
| `src/model/types.ts` | `FontAsset`; `TextObject.sourceFont` y `useSourceFont` |
| `src/model/registry.ts` | `putFont`, `getFont`, `findFont`; registrar y liberar `FontFace` |
| `src/pdf/fontProgram.ts` (nuevo) | Leer la fuente con fontkit: cobertura, anchos, métricas (sin DOM) |
| `src/render/sourceFonts.ts` (nuevo) | Sacar la fuente de pdf.js y aplicar los filtros |
| `src/pdf/textLayout.ts` | Cadena de fuentes, tramos y métricas verticales |
| `src/pdf/fonts.ts` | `cssFontName`, `cssFontFamily` |
| `src/render/textContent.ts` | Fuente dominante de la línea |
| `src/features/editor/overlay/editText.ts`, `PageOverlay.tsx` | `guessFont` arreglado; crear el objeto tras resolver la fuente |
| `src/features/editor/overlay/ObjectView.tsx`, `TextEditor.tsx` | `font-family` con la cadena |
| `src/features/editor/objects.ts` | `createText` con `sourceFont: null` |
| `src/pdf/bake.ts`, `src/pdf/compose.ts`, `src/features/editor/save.ts` | Fuentes inyectadas; incrustar y dibujar por tramos |
| `src/features/editor/PropertiesPanel.tsx` | Opción «(del documento)», aviso de letras que faltan, negrita/cursiva |
| `tests/` | Pruebas nuevas y ampliadas |

## 5. Pasos

Tamaños orientativos: **S** (unas horas), **M** (alrededor de un día), **L** (varios días).
El paso 0 se puede entregar por separado. Las fases 1 a 5 van juntas: hasta el paso 8 no
cambia nada visible.

### Paso 0: Arreglar la detección actual (S)

1. En `guessFont`, usar `font.bold`, `font.italic` y `font.black` del objeto de pdf.js, que en
   pdf.js 6 están siempre disponibles. Mantener la búsqueda por nombre para cuando llegue
   `name`.
2. En `groupLines` (`textContent.ts`), `fontName` debe ser la fuente que cubre más caracteres
   de la línea, no la del primer tramo.

Mejora lo que hay aunque no se haga nada más: una línea en negrita se edita en negrita.

### Fase 1: Obtener la fuente

**Paso 1. Conservar las fuentes en pdf.js (S).** Añadir `fontExtraProperties: true` en
`loadPdfjs`. Medir la memoria antes y después recorriendo un PDF grande (DevTools de
WebView2). Si el coste molesta, plan B: abrir un segundo `getDocument` con esa opción solo al
usar «Editar texto», y localizar la línea por su posición.

**Paso 2. Modelo (S).**

```ts
/** Font program taken from an opened PDF (pdf.js' OpenType conversion of the embedded font). */
export interface FontAsset {
  id: string;
  /** PDF name without the subset tag, e.g. "Calibri-Bold". */
  name: string;
  /** Family shown in the UI, e.g. "Calibri". */
  family: string;
  bytes: Uint8Array;
  bold: boolean;
  italic: boolean;
}
```

`TextObject` gana dos campos:

- `sourceFont: string | null`: id del `FontAsset` original que puede usar este texto. Se fija
  al crearlo y no cambia.
- `useSourceFont: boolean`: si se usa. Cambiar a una fuente estándar solo lo pone a `false`,
  así que se puede volver a la original desde el panel (y Ctrl+Z funciona igual).

`font`, `bold` e `italic` siguen siendo el estilo de respaldo y deben coincidir con el original
(misma negrita y cursiva). En el historial solo entran ids, como con las imágenes. TypeScript
señalará todos los sitios que crean un `TextObject`.

**Paso 3. `src/pdf/fontProgram.ts` (M).** Módulo sin DOM, que se puede probar en Node:

- `loadFontProgram(id, bytes)`: importa `@pdf-lib/fontkit` de forma diferida (para no
  cargarlo al arrancar la app), parsea la fuente y la guarda en caché por id.
  `fontProgram(id)` la devuelve de forma síncrona para el layout y `unloadFontProgram(id)` la
  libera.
- Interfaz `GlyphSource`, común a la fuente original y a las estándar:
  - `has(ch)`: si la fuente tiene ese carácter. Excluye el área de uso privado
    (U+E000-F8FF), donde pdf.js pone sus códigos internos.
  - `advance(ch)`: avance en milésimas de em, con caché.
  - `ascent` y `descent`, en fracción de em (de `hhea`).
  - `hasOutline(ch)`: si el glifo tiene trazo (para detectar fuentes invisibles).
- Las fuentes estándar implementan la misma interfaz con lo que ya hay
  (`StandardFontEmbedder` y `FONT_VMETRICS`).

**Paso 4. Registro (S).** En `src/model/registry.ts`, igual que las imágenes:

- `putFont(meta, bytes)`: crea el id `font_xxxx`, llama a `loadFontProgram` y registra un
  `FontFace` llamado `snow-font-<id>` con:
  - `weight` y `style` iguales a los del original. Si el original es negrita, el CSS pide
    `font-weight: 700`: la fuente original encaja sin negrita sintética, y las letras de
    respaldo salen en Arial Bold de verdad.
  - `ascentOverride`, `descentOverride` y `lineGapOverride: "0%"` con las cifras de fontkit.
    Cada sistema lee las métricas verticales de tablas distintas (`hhea`, `OS/2`); así la
    línea base en pantalla siempre coincide con la del layout. WebView2 lo soporta; revisarlo
    en WebKit cuando se porte a macOS o iOS.
  - Espera a `face.load()` y lo añade a `document.fonts`.
- `getFont(id)`, y `findFont(clave)` como caché por `fuente:fontName`. También guarda los
  fallos, para no reintentar.
- `releaseOwner` y `clearRegistry` quitan el `FontFace` de `document.fonts` y llaman a
  `unloadFontProgram`.

**Paso 5. `src/render/sourceFonts.ts` (M).**
`resolveSourceFont(sourceId, pdfPage, line): Promise<FontAsset | null>`:

1. Mirar la caché.
2. Pedir la fuente con la forma de callback, `pdfPage.commonObjs.get(fontName, cb)`, envuelta
   en una promesa con un límite de unos 1,5 s. Hoy se usa `get(fontName)`, que lanza una
   excepción si la fuente aún no ha llegado (las fuentes llegan al renderizar la página).
3. Descartarla (devolver `null`) si es un error, `isType3Font`, `isInvalidPDFjsFont`,
   `missingFile` (no incrustada) o `vertical`, si tiene `cssFontInfo` o `systemFontInfo`, o si
   no tiene `data`.
4. Copiar los bytes (`data.slice()`) para no depender del ciclo de vida de pdf.js.
5. Parsearla y aplicar los filtros de calidad:
   - **Cobertura:** al menos el 90 % de los caracteres de `line.text` (sin contar espacios)
     deben estar en la fuente. Si no, el texto extraído y la fuente no casan (por ejemplo, un
     PDF sin ToUnicode).
   - **Glifos vacíos:** los caracteres de muestra deben tener trazo. Las capas de OCR usan a
     propósito fuentes invisibles (GlyphLessFont).
   - **Escala:** el ancho natural de `line.text` con esta fuente, al tamaño de la línea, debe
     estar entre 0,7 y 1,3 veces el ancho original. Detecta fuentes con una `FontMatrix` rara;
     las líneas justificadas quedan dentro.
   - **Métricas verticales razonables:** `0,5 < ascent + descent < 2,5`.
6. Nombre: `font.name` sin el prefijo `ABCDEF+`. Familia: el nombre sin sufijos de estilo
   (`-Bold`, `,Italic`, `MT`, `PS`…).
7. Llamar a `putFont`. Si algo falla, devolver `null` y anotar el motivo con `console.debug`.

### Fase 2: Medidas compartidas

**Paso 6. `src/pdf/textLayout.ts` (M).**

- `fontChain(o)` devuelve `[fontProgram(o.sourceFont), estándar(o.font, o.bold, o.italic)]`
  si `useSourceFont` está activo y la fuente está cargada. Si no, solo la estándar, que es
  exactamente el comportamiento de hoy.
- `splitRuns(texto, cadena)`: normaliza a NFC (para que «ñ» sea un solo carácter) y agrupa los
  caracteres seguidos que usan la misma fuente en tramos `{ text, font, width }`. El último
  eslabón acepta todo: al guardar, `encodableText` ya cambia por «?» lo que no cabe en WinAnsi.
- `textWidth` pasa a ser la suma de los tramos, y `layoutText` devuelve también los tramos de
  cada línea.
- `baseline` usa las métricas de la **primera** fuente de la cadena, porque el CSS calcula la
  caja de línea con la fuente principal.
- Se mantiene la regla de no aplicar kerning.

`runFrame` (búsqueda y resaltado) no cambia: llama a `textWidth` sin `sourceFont`.

### Fase 3: Pantalla

**Paso 7. CSS (S).** En `src/pdf/fonts.ts`, `cssFontName(id)` y `cssFontFamily(o)`, que
devuelve `"snow-font-<id>", Helvetica, Arial, …` o la pila de hoy. `ObjectView` y `TextEditor`
usan `cssFontFamily(obj)` en lugar de `CSS_FONT_STACKS[obj.font]`; el peso y el estilo no
cambian. El navegador cae letra a letra igual que `splitRuns`, porque ambos leen la misma
`cmap`. `.snow-text` ya desactiva el kerning y las ligaduras.

**Paso 8. Crear el objeto (S).** En `PageOverlay` (caso `editText`), esperar a
`resolveSourceFont` antes de `createReplacement`. El estilo de respaldo sale de `guessFont`
(paso 0); si hay fuente original, mandan su `bold` y su `italic`. La colocación no cambia:
ya usa `layoutText`, que ahora mide con la fuente real. Resultado esperado: si no se toca el
texto, el ancho coincide con el original.

### Fase 4: Guardar

**Paso 9. `compose.ts` y `bake.ts` (M).**

- `ComposeInput` gana `font?(id): { bytes: Uint8Array; name: string } | null`, inyectada como
  `asset`, para que `compose` se siga pudiendo probar en Node.
- `Baker` guarda en caché las fuentes incrustadas. La primera vez llama a
  `doc.registerFontkit(fontkit)` y luego a
  `doc.embedFont(bytes, { subset: false, customName: name, features })`:
  - `subset: false` porque la fuente ya es un subconjunto pequeño, y así no se vuelve a
    recortar (menos riesgo, sobre todo con fuentes CFF).
  - `features` con las sustituciones (`liga`, `clig`, `calt`, `kern`) desactivadas. Las fuentes
    de pdf.js no las tienen, pero las del sistema (paso 14) sí, y el ancho debe ser la suma de
    las letras.
- Al dibujar cada línea, cada tramo usa su fuente (la incrustada, o la estándar con
  `encodableText`) en `x = inicio de línea + ancho acumulado`, con la misma `y`.
- Si `font(id)` devuelve `null`, el objeto se mide y se dibuja como si `useSourceFont` fuera
  `false`, de modo que medidas y dibujo siempre coinciden.
- No depende del objeto fuente original: tras redactar se recarga el documento
  (`doc = await loadPdf(redacted)`) y el `Baker` se crea después.

**Paso 10. `save.ts` (S).** `buildPdf` pasa `font: (id) => getFont(id)`, que devuelve `null`
si falta.

### Fase 5: Panel de propiedades

**Paso 11. `PropertiesPanel.tsx` (S).**

- `TextStyleEditor` recibe la fuente original, si la hay. El desplegable «Fuente» empieza con
  «Calibri (del documento)» y luego las tres estándar.
- Elegir una estándar pone `useSourceFont: false` y la nueva `font`, con `refitText` como
  ahora. Elegir «(del documento)» pone `useSourceFont: true`, con la negrita y la cursiva del
  original.
- Pulsar Negrita o Cursiva con la fuente original activa pasa a la estándar con ese estilo, y
  se puede volver desde el desplegable. El paso 15 lo mejora.
- Aviso: «La fuente original no incluye: «ñ», «Q». Esas letras usan Helvetica.», calculado con
  `splitRuns`.
- No guardar `sourceFont` ni `useSourceFont` con `setStyle("text", …)`: no deben colarse en
  los valores por defecto de la herramienta Texto.

### Fase 6: Pruebas

**Paso 12. Automáticas (M).** Con vitest en Node:

- `tests/fontProgram.test.ts`: usa
  `node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf` (licencia OFL, ya
  instalada; no añade binarios al repositorio). Comprueba `has`, `advance`, las métricas y que
  el área de uso privado queda excluida.
- Integración con pdf.js en Node (worker falso, `fontExtraProperties: true`): crear con
  pdf-lib + fontkit un PDF con un subconjunto de Liberation Sans que diga «Hola mundo»,
  cargarlo, llamar a `getOperatorList()` y leer la fuente de `commonObjs`. Prueba la
  conversión real de pdf.js: tiene «H», no tiene «ñ», y los filtros del paso 5 la aceptan. Si
  pdf.js en Node da problemas, guardar esa fuente convertida como fixture pequeño en
  `tests/fixtures/` (la licencia OFL lo permite).
- `tests/compose.test.ts` (ampliar): un `TextObject` con fuente original y el texto «Hola
  España» → exportar → leer con MuPDF. El texto es «Hola España», todas las letras van en la
  fuente original salvo la «ñ» (Helvetica), y la línea base está donde se espera.
- Regresión: sin `sourceFont`, `layoutText` da exactamente lo mismo que hoy.

**Paso 13. Manuales (M).** PDFs de varios orígenes:

| Origen | Tipo de fuente | Resultado esperado |
|---|---|---|
| Word (Calibri) | TrueType recortada | Fuente original |
| LaTeX | Type1 (pdf.js la convierte a CFF) | Fuente original |
| Chrome/Edge «Imprimir a PDF» | CID TrueType, Identity-H | Fuente original |
| InDesign / Illustrator | OpenType CFF | Fuente original |
| Escaneo con OCR | GlyphLessFont | Respaldo (no texto invisible) |
| Arial sin incrustar | No incrustada | Respaldo |
| PDF con fuentes Type3 | Type3 | Respaldo |

En cada uno: editar sin cambiar nada, guardar y superponer con el original; escribir letras
que no estén en la fuente; copiar y pegar el texto del PDF guardado; reabrirlo y volver a
editar la misma línea.

### Fase 7: Mejoras opcionales (después)

- **Paso 14. Fuentes del sistema (L).** Completar las letras que faltan con la fuente completa
  instalada en Windows con el mismo nombre (Calibri, Arial, Cambria…), y usarla también para
  las fuentes no incrustadas. La cadena queda `[subconjunto original, fuente del sistema,
  estándar]`. Hay que leer `C:\Windows\Fonts` y las fuentes del usuario desde Rust (comando de
  Tauri) y respetar el permiso de incrustación (`fsType` de `OS/2`). Probablemente requiere un
  crate nuevo, y eso hay que acordarlo (convención del proyecto).
- **Paso 15. Variantes hermanas.** Al pulsar Negrita, buscar «Calibri-Bold» entre las fuentes
  que pdf.js ya cargó del mismo documento (`commonObjs` se puede recorrer).
- **Paso 16. Fuentes del documento en la herramienta Texto.** Solo tiene sentido con el
  paso 14: un subconjunto casi nunca trae todas las letras.
- **Paso 17. Líneas justificadas.** Si el texto no cambia, mantener el ancho original con
  espaciado entre palabras (`Tw` en el PDF, `word-spacing` en CSS).
- **Paso 18. Ligaduras del original (ﬁ, ﬂ).** Si el subconjunto solo trae la ligadura, usarla
  en lugar de «f» + «i» en ese tramo.

## 6. Riesgos

| Riesgo | Mitigación |
|---|---|
| Más memoria por `fontExtraProperties` | Medir (paso 1); plan B con un segundo documento bajo demanda |
| Depender de detalles internos de pdf.js (`font.data`, la `cmap`) | Versión fijada en `package.json`; el test de integración avisa al actualizar |
| El navegador o fontkit rechazan una fuente rara | `try/catch` → respaldo, como hoy |
| La pantalla y el PDF no coinciden en vertical | `ascentOverride`/`descentOverride`; test de línea base |
| Fuente invisible (OCR) | Filtro de glifos vacíos |
| El texto extraído y la fuente no casan (sin ToUnicode) | Filtro de cobertura |
| Tamaño distinto (`FontMatrix` rara) | Filtro de escala |
| Pegar en otra pestaña después de cerrar la original | Se ve y se guarda con el respaldo, de forma coherente (con las imágenes ya pasa algo parecido) |
| Más peso de la app por fontkit | Importación diferida |
| Licencia de la fuente | Se reincrusta una fuente que ya venía incrustada en el mismo documento; con fuentes del sistema (paso 14), respetar `fsType` |

## 7. Limitaciones conocidas (aceptadas)

- Una sola fuente por objeto: en una línea con una palabra en negrita gana la fuente dominante,
  como hoy.
- Las líneas justificadas conservan su ancho (paso 17, hecho) mientras sean de una sola línea.
  Las de escala horizontal (`Tz`) quedan con su ancho natural.
- Las letras que el PDF no trae se ven con la fuente parecida, hasta el paso 14.
- Fuentes Type3, verticales o no incrustadas: respaldo.
- Los anchos salen de la propia fuente (`hmtx`); en casos raros difieren un poco de los
  `/Widths` del PDF.

## 8. Criterios de aceptación

- Editar una línea sin cambiar nada y guardar: no se nota diferencia con el original (mismo
  ancho ±2 %, misma línea base) en PDFs de Word, LaTeX y Chrome.
- Las letras que faltan se ven igual en pantalla que en el PDF guardado.
- El texto del PDF guardado se puede seleccionar, copiar y buscar.
- Si la fuente no se puede reutilizar, el resultado es idéntico al de hoy.
- `npm run typecheck`, `npm test` y `npm run build` terminan sin errores.
