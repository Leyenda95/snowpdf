# Investigación de funciones: iLovePDF y Adobe Acrobat (2026)

Proyecto: SnowPDF (aplicación PDF de escritorio 100 % local; Windows primero, móvil después).
Fecha de consulta: 2026-10-26.
Objetivo: inventario actualizado de las funciones de dos productos de referencia para decidir qué construir.

---

## 0. Metodología, fuentes y límites de la investigación

- Consultas en vivo con WebFetch/WebSearch a: ilovepdf.com (home, 30+ páginas de herramienta, /pricing, /desktop, /features, blog), iloveapi.com/docs (referencia de parámetros de las herramientas), adobe.com/acrobat (pricing, pdf-reader, features, online/*), experienceleague.adobe.com, adobe.com/learn/acrobat, notas de versión de Acrobat (devnet-docs), GitHub de pdf.js, documentación de MuPDF/mupdf.js y READMEs de pdf-lib/@cantoo/pdf-lib.
- Limitación importante: `helpx.adobe.com` devolvió HTTP 403 a WebFetch en todos los intentos. El detalle de menús de Acrobat que procede de helpx se obtuvo a través de resúmenes del buscador que citan esas páginas, de guías universitarias o de terceros y de la ayuda de versiones anteriores. En esos casos se indica "fuente secundaria" o "(no verificado)".
- Solo se pudo leer el texto de las páginas (no capturas ni la UI en ejecución). La descripción de UX se basa en textos de interfaz, ayuda y blogs, no en observación visual directa.
- Precios y límites cambian por región y con frecuencia. Los de iLovePDF salen de su página /pricing (EUR); los de Adobe, de adobe.com/acrobat/pricing.html (USD, particulares).
- "(no verificado)" = no se pudo confirmar en una fuente fiable durante esta sesión.
- Contexto del proyecto leído (solo lectura): `docs/ARCHITECTURE.md` y `src/features/tools/registry.ts`. Se usan para la columna "En SnowPDF" de la sección D. Esa columna refleja lo que dicen esos documentos (v0.1/v0.2/v0.3); no se auditó el código, que estaba en construcción.

### Resumen ejecutivo

1. iLovePDF ofrece 33 herramientas (más Workflows) en 7 grupos: Organizar, Optimizar, Convertir a PDF, Convertir desde PDF, Editar, Seguridad e Inteligencia (IA). La mayoría son operaciones simples sobre archivos o páginas y se pueden replicar en local. Lo difícil: Office a PDF y PDF a Office con buena fidelidad, OCR de calidad, PDF/A y todo lo que es IA (Smart Split, Smart Redact, Detect forms, resumen, traducción).
2. Novedades de iLovePDF en 2026: Translate PDF (feb), editor avanzado que edita el texto existente (feb), Workflows (mar), Smart Split (may), PDF Forms (may), PDF a Markdown (jul), Desktop reconstruido en Qt 6 (oct) y "mezclar cualquier tipo de archivo" en Desktop (sep). El mercado se mueve hacia edición de texto existente, formularios e IA.
3. Acrobat Reader gratis: ver, imprimir, comentar (resaltar, subrayar, tachar, notas, texto, dibujo), rellenar formularios, firmar (dibujar, escribir, imagen) y compartir. Todo lo demás es de pago. Standard: editar, organizar, combinar, exportar, formularios, proteger. Pro: OCR, redacción, comparar, Bates, "70+ herramientas" (impresión profesional, accesibilidad, Action Wizard, medir). Studio: IA (AI Assistant, PDF Spaces, Express).
4. Ventaja competitiva posible de SnowPDF: ofrecer gratis y sin subir nada lo que en iLovePDF/Acrobat es de pago, tiene límites o exige subir el archivo (OCR, redactar, comparar, comprimir sin cuotas, proteger con permisos, PDF/A).
5. Hallazgo técnico: el visor genérico de pdf.js 6.4.299 (oct-2026) ya incorpora editores (resaltar, texto, tinta, sello, firma, comentarios), organización de páginas (fusionar, extraer, borrar/cortar/copiar/pegar, miniaturas arrastrables) y verificación de firmas digitales; sirve de referencia de implementación (Apache-2.0). MuPDF 1.28 aporta redacción real, cifrado, optimización y reescritura de imágenes (en la CLI; su exposición en mupdf.js no está verificada). @cantoo/pdf-lib 2.x cifra con AES-256.
6. Riesgos: licencia AGPL de MuPDF si se distribuye el programa; Office a PDF y PDF a Word sin motor propio; memoria WASM con PDFs enormes; el pdf-lib original lleva sin publicarse desde nov-2021 (el proyecto usa el fork @cantoo).

---

## A. iLovePDF: herramientas

### A.1 Planes y límites (según ilovepdf.com/pricing)

- Planes: Free (Basic), Premium (1 a 25 usuarios: 5 EUR/mes facturado anualmente = 60 EUR/año, o 9 EUR/mes mensual) y Business (25+, a medida).
- Solo Premium: todas las herramientas, procesamiento por lotes ilimitado, límites altos (4 GB por archivo), OCR dentro de las conversiones a Office, PDF a PDF/A, Workflows, equipos, sin anuncios, apps de escritorio y móvil, 2.000 créditos de IA (Smart Split y Smart Redact hasta 200 páginas; IA avanzada 67 páginas), procesamiento regional.
- Límites de Basic frente a Premium (la tabla de precios los titula "Tasks"; se interpretan como número de archivos por tarea, no verificado; la tabla A.2 los cita como archivos con esa reserva): Merge 25/500 y 100 MB/4 GB; Split 1/1; Compress 2/10 y 200 MB/4 GB; Office a PDF y PDF a Office 1/10 y 15 MB/4 GB; OCR 1/10 y 15 MB; PDF a JPG 2/10 y 25 MB; imagen a PDF 20/80 y 40 MB; Rotate 20/80; Protect 2/80; Organize 5/20; Edit PDF 1/1 y 100 MB; Sign 3/5 y 50 MB; Redact 1/1 y 400 MB; Compare 2/2 y 400 MB; PDF Forms 1/1 y 15 MB (Premium 100 MB); AI Summarizer 1/1 y 50 MB; Translate y PDF a Markdown 1/1 y 15 MB (Premium 200 MB).
- Privacidad: los archivos subidos se borran automáticamente a las 2 horas; Desktop procesa en local.
- Ambigüedades de la propia web: la tabla de funciones marca "No" en Basic para AI Summarizer y Translate (IA estándar), mientras la tabla de límites les da cuota a Basic. La app móvil figura como "No" en Basic, pero Scan to PDF figura como "Yes". Lo que sí está claro: la "Advanced AI" consume créditos y estos solo vienen con Premium.

### A.2 Tabla de herramientas (categorías propias de iLovePDF)

| Categoria | Herramienta | Que hace | Opciones principales | Gratis/Premium |
|---|---|---|---|---|
| Organize PDF | Merge PDF | Une varios PDF en uno | Reordenar arrastrando; multiselección con Ctrl; botón "ordenar por nombre" (A-Z); añadir más archivos; mostrar/ocultar portadas; importar de Google Drive/Dropbox. No hay más opciones (ni índice, ni selección de páginas). Desktop (sep-2026): también mezcla Word, Excel, PowerPoint e imágenes | Gratis (Basic 25 archivos/100 MB; Premium 500/4 GB) |
| Organize PDF | Split PDF | Divide un PDF | Pestaña Range: modo Custom (rangos "from page / to page" con "Add Range"), Fixed (trozos de N páginas; muestra cuántos PDF saldrán) y Smart (IA: categoría de documento + preset, o "Custom prompt"); casilla "unir todos los rangos en un PDF". Pestaña Pages: "Extract all pages" o "Select pages" + casilla de unir. Pestaña Size: tamaño máximo por archivo en KB/MB + "Allow compression" | Gratis (Range, Pages). Premium: Size. Smart Split consume créditos de IA (Premium, 200 págs) |
| Organize PDF | Remove pages | Elimina páginas | Miniaturas clicables; Shift para rangos; contadores "Total pages" y "Pages to remove"; importar de nube | Gratis |
| Organize PDF | Extract pages | Saca páginas a un PDF nuevo (o un PDF por página) | Es la pestaña Pages de Split: "Extract all pages" / "Select pages" y casilla "unir páginas extraídas" | Gratis |
| Organize PDF | Organize PDF | Reordena, borra y añade páginas | Miniaturas arrastrables; "Order pages by number" (1-9); "Mix PDF pages" (intercala páginas de varios PDF: p1 de cada uno, luego p2...); "+" entre dos páginas inserta una página en blanco; "+" rojo añade más archivos; borrar página al pasar el ratón; rotar página individual (control concreto no verificado); "Reset all"; guardar en Drive/Dropbox | Gratis (Basic 5/Premium 20) |
| Organize PDF | Scan to PDF | Escanea con el móvil y recibe el PDF en el navegador | QR que empareja con la app móvil de iLovePDF; tras escanear: orientación (vertical/horizontal), tamaño (Fit/A4/US Letter), margen (sin/pequeño/grande), unir en un PDF; "Re-scan". Hay que dejar abierta la pestaña | Gratis en web (ambigüedad con la app móvil, ver A.1) |
| Optimize PDF | Compress PDF | Reduce el tamaño | 3 niveles: "Extreme compression" (menos calidad), "Recommended" (por defecto), "Less compression" (más calidad). Sin DPI, calidad numérica ni tamaño objetivo (la API: extreme/recommended/low) | Gratis (Basic 2 archivos/200 MB; Premium 10/4 GB) |
| Optimize PDF | Repair PDF | Intenta recuperar un PDF dañado | Sin opciones; recupera "parcial o totalmente"; si detecta otro formato puede ofrecer descargarlo así | Gratis |
| Optimize PDF | OCR PDF | Convierte un PDF escaneado en PDF con texto seleccionable y buscable | Selección de idiomas del documento (más de 100, incluido español y "Math / Equation detection"); la precisión mejora eligiendo el idioma correcto. Sin opción de deskew ni de salida distinta de PDF buscable (no documentadas) | Gratis (Basic 1 archivo/15 MB; Premium 10/4 GB) |
| Convert to PDF | JPG to PDF | Imágenes a PDF | Orientación (Portrait/Landscape); tamaño (Fit = tamaño de la imagen, A4, US Letter); margen (No margin/Small/Big); casilla "Merge all images in one PDF"; ordenar por nombre. La web solo cita JPG; la API acepta JPG, PNG y TIFF | Gratis (Basic 20 imágenes/40 MB) |
| Convert to PDF | Word to PDF | DOC/DOCX a PDF | Sin opciones (subir, ordenar, convertir) | Gratis (Basic 1 archivo/15 MB) |
| Convert to PDF | PowerPoint to PDF | PPT/PPTX a PDF | Sin opciones | Gratis (Basic 1/15 MB) |
| Convert to PDF | Excel to PDF | XLS/XLSX a PDF | Sin opciones | Gratis (Basic 1/15 MB) |
| Convert to PDF | HTML to PDF (Web to PDF) | Páginas web o HTML a PDF | Entrada: URL, archivos html/css/js, ZIP o pegar HTML (con vista previa). Opciones: tamaño de pantalla (1200/1920/1440/768/320 px), tamaño de página (A3/A4/A5/Letter), casilla "One long page", orientación, margen, "Try to block ads", "Remove overlay popups", "Reset all" | Gratis (sin marca de premium) |
| Convert from PDF | PDF to JPG | Páginas a imágenes o extracción de imágenes | Modo "Page to JPG" (cada página una imagen) o "Extract images" (imágenes incrustadas); calidad Normal (recomendada) o High; sin DPI explícito | Gratis (Basic 2 archivos/25 MB) |
| Convert from PDF | PDF to Word | PDF a DOC/DOCX editable (motor Solid Documents) | "No OCR" (PDF con texto) u "OCR Premium" (escaneados; unos 24 idiomas); avisa si detecta páginas escaneadas | Gratis sin OCR. Premium: OCR |
| Convert from PDF | PDF to PowerPoint | PDF a PPT/PPTX editable | Igual que PDF to Word (No OCR / OCR Premium) | Gratis sin OCR. Premium: OCR |
| Convert from PDF | PDF to Excel | PDF a hoja de cálculo | No OCR / OCR Premium; "Layout": One sheet o Multiple sheets | Gratis sin OCR. Premium: OCR |
| Convert from PDF | PDF to PDF/A | Convierte a PDF/A de archivo | 8 niveles: 1b, 1a, 2b, 2u, 2a, 3b, 3u, 3a (la serie 3 permite adjuntar XML/CSV/CAD); casilla "Allow downgrade of PDF/A compliance level". La API también tiene validación PDF/A | Premium |
| Edit PDF | Rotate PDF | Rota PDF completos (uno o varios a la vez) | Icono de rotación al pasar el ratón sobre cada archivo; filtro "All/Portrait/Landscape"; dirección Right/Left; "Reset all". No rota páginas sueltas (para eso Organize) | Gratis (Basic 20/Premium 80) |
| Edit PDF | Add page numbers | Numera páginas | "Page mode": Single page / Facing pages / First page is cover page; posición; margen (Small/Recommended/Big); "First number"; rango from/to con exclusiones ("Exclude the first page"... "Exclude the last 5 pages"); texto: solo número, "Page {n}", "Page {n} of {p}" o Custom con {n}, {p}, {r}, {rf}; fuente (9 familias), tamaño, color de fuente, color de fondo, sombra, opacidad | Gratis (Basic 2 archivos/100 MB) |
| Edit PDF | Add watermark | Marca de agua de texto o imagen | "Place text" / "Place image"; texto: fuente (9), tamaño, color, color de fondo, sombra, opacidad; posición (incluye "Mosaic"; la API usa rejilla 3x3 + ajuste fino); transparencia (sin/75/50/25 %); rotación (0/45/90/180/270); rango de páginas from/to; capa "Over/Below the PDF content" | Gratis (Basic 2 archivos/100 MB) |
| Edit PDF | Crop PDF | Recorta márgenes | Se dibuja arrastrando el área que se conserva (redimensionable), "Reset all"; ámbito "All pages" o "Current page" (sin rango); sin márgenes numéricos ni autodetección | Gratis (Basic 1 archivo/100 MB) |
| Edit PDF | Edit PDF | Editor en el navegador | Pestañas "Annotate", "Edit" y "Elements". Edita texto existente (fuente, tamaño, color, formato, hipervínculos), mueve o borra; añade texto, imágenes (logos, firmas), enlaces, campos de formulario (firma, texto, casilla, radio, lista), adjuntos y marcadores; anota con resaltar, subrayar, tachar, ondulado, dibujo libre y rotulador libre; orden de capas (al frente/al fondo); "Remove all"; ve propiedades de certificados | Gratis (1 tarea/100 MB) |
| Edit PDF | PDF Forms (nuevo) | Crea, edita y rellena formularios | Modos "Fill Form", "Edit Form" y "Detect with AI" (convierte escaneados o aplanados en campos interactivos). Campos: Signature, Text, Free Text, Checkbox, Radio, List Box, Combo. Propiedades: Read only, Required, Multiline, indicador de campo, Multiselect. Estilo: tamaño y color de texto, relleno, borde. Alt/Option-arrastrar duplica; alinear y distribuir; atajos | Gratis (Basic 15 MB; Premium 100 MB). Premium: Detect with AI (no gasta créditos) |
| PDF Security | Unlock PDF | Quita la seguridad por contraseña | Un único botón "Unlock PDF"; la página no aclara si exige la contraseña de apertura (no verificado) | Gratis (Basic 2 archivos) |
| PDF Security | Protect PDF | Cifra con contraseña | Pestañas "Basic" y "Advanced"; reglas de contraseña (mayúsculas y minúsculas, número, carácter especial, mínimo 8); "Restrict access"; Advanced: contraseña de permisos y casillas "Disable printing / content modification / content copy and extraction / comments / form filling / content extraction for accessibility / document assembly"; aviso de que algunas apps no respetan las restricciones. No indica la fuerza del cifrado | Gratis (Basic 2 archivos/100 MB; Premium 80) |
| PDF Security | Sign PDF | Firmar uno mismo o pedir firmas | "Only me" o "Several people"; "Simple Signature" o "Digital Signature" (Premium; hash certificado y sello de tiempo cualificado, eIDAS/ESIGN/UETA). Firma: dibujar, subir (PNG/JPG/SVG) o dibujar desde el móvil; iniciales; sello de empresa; color. Campos: Signature, Initials, Name, Date (6 formatos), Text, Input (con etiqueta e indicaciones), Company Stamp; obligatorio/opcional; colocar en esta página, todas, todas menos la última, última o personalizadas; copias enlazadas; atajos de teclado (s, i, n, d, t). Solicitud: orden de firmantes, caducidad (15 días por defecto), recordatorios (cada día), avisos por email, UUID, QR de verificación en la pista de auditoría, código de acceso, SMS, plantillas, idioma, personalizar el email | Gratis: firma simple propia y solicitudes básicas (Basic 3 tareas/50 MB). Premium: firma digital, solicitudes múltiples, branding de email, plantillas, auditoría |
| PDF Security | Redact PDF | Tachado permanente de información sensible | Marcar texto o páginas completas (icono de redacción y de página); barra de búsqueda de palabras; detección básica "Text / Credit Card / Phone Number / Email"; "Smart redact" (detección mejorada con IA); panel "Marked for redaction" y "Clear all"; si el PDF no tiene texto seleccionable remite a OCR; recomienda revisar el resultado | Gratis (básico; Basic 400 MB). Smart redact: Premium con créditos de IA (200 págs) |
| PDF Security | Compare PDF | Compara dos versiones | Modos "Semantic Text" (cambios de texto) y "Content Overlay" (superpone y colorea diferencias); "Scroll sync"; "Change report" con el recuento de cambios; paneles "First document" y "Second document" | Gratis (Basic 2 tareas/400 MB) |
| PDF Intelligence | AI Summarizer (nuevo) | Resume un PDF | Longitud Short/Medium/Long; "Standard AI" o "Advanced AI" (requiere créditos); el idioma es el de la web; botones Copy y Download (la API: salida PDF o Markdown) | Premium para IA estándar según la tabla de precios (ambigua, ver A.1); Advanced AI con créditos |
| PDF Intelligence | Translate PDF (nuevo) | Traduce con IA conservando el diseño | "From" (unos 180 idiomas de origen) y "To" (unos 30 de destino); salida "Keep layout" (conserva imágenes y diseño) u "Only text" (texto y jerarquía); "Standard AI" o "Advanced AI" (créditos; 67 págs) | Premium (ambiguo, ver A.1) |
| PDF Intelligence | PDF to Markdown (nuevo) | PDF a .md manteniendo encabezados, tablas, listas y enlaces | Sin opciones | Gratis según la tabla de precios (Basic 15 MB) |
| (transversal) | Workflows | Encadena hasta 4 herramientas en una secuencia guardada y reutilizable (subes una vez) | Crear con "Add a workflow": nombre + herramientas; requiere iniciar sesión | Premium |
| (transversal) | iLovePDF Desktop | App offline para Windows (Microsoft Store) y Mac | Lector gratuito con miniaturas, pestañas, modo claro/oscuro, historial de tareas y archivos recientes; edición de metadatos (Author, Keywords, Creator, Producer); menú contextual del explorador (convertir o comprimir sin abrir la app); procesamiento local; 25 idiomas; "20 herramientas" (Split, Merge, Compress, Organize, Repair, Convert...). Rediseñada en Qt 6/QML (oct-2026) | Herramientas de escritorio: Premium (9 EUR/mes o 60 EUR/año). La página de Desktop es ambigua sobre qué es gratis |
| (transversal) | Móvil, extensiones, API | Apps iOS/Android (multiventana en iPad desde oct-2026), extensiones de Chrome, iLoveAPI (REST) con conectores Zapier, Make, WordPress, Power Automate, Odoo, plugin de ChatGPT y servidor MCP | La API expone además `extract` (texto con coordenadas), `validatepdfa` y `formsdetect` | De pago/por créditos (no verificado el detalle) |

Notas adicionales sobre iLovePDF:

- Cronología 2026 según su blog: Translate PDF (25-feb), nuevo editor avanzado (27-feb), Workflows (12-mar), Smart Split (8-may), PDF Forms (11-may), extensiones de Chrome (22-may), PDF a Markdown (22-jul), Desktop fusiona cualquier tipo de archivo (7-sep), ChatGPT y MCP (25-sep), automatización/API (9-oct), Desktop en Qt 6 (23-oct). Un agregador de terceros da fechas algo distintas; se usan las del blog.
- Smart Split (IA) ofrece 12 categorías con presets (facturas, contratos, extractos bancarios, académico, médico, RR. HH., seguros, logística/aduanas, administración, lotes escaneados, marketing, libros) más "Custom prompt".
- Sister products fuera de alcance: iLoveIMG (herramientas de imagen), iLoveSign (firma electrónica) e iLoveAPI.

---

## B. Adobe Acrobat

### B.1 Planes (adobe.com/acrobat/pricing.html, USD, particulares)

- Acrobat Reader: gratis. Standard: 14,99 USD/mes (anual facturado mensual), 179,88 USD/año prepago, 24,99 USD/mes mensual. Pro: 19,99 / 239,88 / 29,99. Studio: 24,99 / 299,88 / 34,99.
- Tabla oficial de comparación (Standard / Pro / Studio): Standard incluye editar texto e imágenes con ajuste automático de formato, añadir/borrar/organizar páginas, combinar tipos de archivo, exportar a Word/Excel/PowerPoint, crear/rellenar/firmar/enviar formularios, solicitar firmas y hacer seguimiento, compartir enlaces para revisión, herramientas de marcado y contraseña. No incluye comparar PDF, "70+ herramientas" ni redactar (son de Pro). Studio añade IA (AI Assistant, PDF Spaces, podcasts, presentaciones, Adobe Express, Stock y Fonts).
- Otra comparación de Adobe (versión regional) asigna a Pro/Studio: enviar solicitudes de firma masivas, OCR, comparar, redactar, branding de acuerdos, formularios web y plantillas de firma reutilizables. Terceros (PCWorld, comunidad Adobe, Mapsoft) añaden como solo Pro: Bates, objetos multimedia/interactivos, Preflight, impresión profesional, accesibilidad (comprobar y reparar), Action Wizard y Measure. Standard permite solo "2 documentos al mes" para recoger firmas según la comunidad Adobe (la página oficial muestra "2 documents/month" sin etiquetar el plan).
- AI Assistant: no es de Reader; es un complemento de pago e incluido en Studio. Precio sin confirmar: Adobe cita 1,99 USD/mes (19,99 USD/año) junto al plan Pro para estudiantes y profesores; terceros hablan de 4,99 USD/mes.
- Plataformas de Standard (solo Windows o también Mac): fuentes contradictorias (no verificado).

### B.2 Tabla de funciones de Acrobat

Leyenda de la última columna: "Gratis (Reader)" = disponible en Acrobat Reader gratuito; "Standard+" = de pago desde Standard; "Pro" = de pago desde Pro; "Studio/add-on" = IA. Se añade "(no verificado)" o "fuente secundaria" cuando el nivel exacto no se pudo confirmar en Adobe.

| Area | Funcion | Detalle | Reader gratis / De pago |
|---|---|---|---|
| Visualización | Ver e imprimir | Conserva fuentes, maquetación y contenido incrustado; Windows, Mac, iOS, Android y versión web sin instalar | Gratis (Reader) |
| Visualización | Modos de página | Single Page (por defecto), Enable Scrolling, Two Page, Two Page Scrolling; Read Mode (oculta barras); Full Screen. Ajuste por documento con preferencia global (fuente secundaria: guías y comunidad Adobe) | Gratis (Reader) |
| Visualización | Zoom y vista | En la parte baja de la barra derecha: contador y navegación de páginas, rotar vista, diseño de página y zoom | Gratis (Reader) |
| Navegación | Paneles | Barra derecha ("right rail"): arriba Comentarios, Marcadores y Páginas (miniaturas); personalizable con clic derecho | Gratis (Reader) |
| Navegación | Búsqueda | Icono de lupa en la barra global: busca texto en el PDF y también herramientas; prompts de IA contextuales en la búsqueda (notas jun-2026). Búsqueda avanzada en varios PDF e índices: (no verificado) | Gratis (Reader, básica) |
| Navegación | Read Out Loud | View > Read Out Loud: leer solo esta página o hasta el final del documento; pausa y parada; necesita un motor de voz del sistema y un PDF accesible (no lee escaneados sin OCR). Fuente: ayuda de Adobe vía buscador | Gratis (Reader) |
| Navegación | Otros de visor | Pestañas, capas, adjuntos, panel de firmas, lupa/snapshot | (no verificado en la UI 2026) |
| Compartir | Share | Enviar por enlace; el destinatario ve y comenta sin iniciar sesión; niveles de acceso | Gratis (Reader) |
| Comentar | Resaltar texto | Color y opacidad ajustables; "Keep tool selected" (chincheta) para resaltar varias veces; nota con comentario | Gratis (Reader) |
| Comentar | Subrayar y tachar | Con comentario asociado | Gratis (Reader) |
| Comentar | Reemplazar e insertar texto | "Add note to replace text" (tachado azul + caja de comentario) e "Insert text at cursor" (caret + caja) | Acrobat sí; en Reader (no verificado) |
| Comentar | Texto, cuadro de texto, llamada | "Add text comment" con fuente, tamaño y color; Text Box; Callout. Adobe confirma texto escrito y free text en Reader; Callout (no verificado en Reader) | Gratis (Reader) |
| Comentar | Nota adhesiva (sticky note) | Pop-up; menú de tres puntos: Set Status (accepted, cancelled, completed, rejected) y Properties (color, forma, opacidad, historial de revisión); clic derecho en un elemento > Add Sticky Note | Gratis (Reader) |
| Comentar | Dibujo libre y borrador | "Draw freehand" y "Erase a drawing" | Gratis (Reader) |
| Comentar | Formas | Rectángulo, óvalo, flecha, línea, nube (cloud), polígono y "Connected lines"; en el menú rápido izquierdo bajo "Draw freehand". En Reader solo si el PDF tiene el comentario habilitado (fuente secundaria) | Gratis (Reader) |
| Comentar | Sellos (stamps) | Dinámicos (fecha, hora, nombre del colaborador), "Sign Here" (banderas para iniciales/firma), estándar de negocio (Approved, Draft, Confidential) y personalizados; paleta de sellos | Acrobat sí; en Reader (no verificado; las notas de versión jun-2026 citan la paleta de sellos para ambos) |
| Comentar | Adjuntar archivo y audio | Herramientas clásicas de comentario | (no verificado en la versión actual) |
| Comentar | Panel de comentarios | Lista con ordenar (página, autor, fecha, tipo, color, no leídos), filtrar (estado, revisor, tipo, color), responder, marcar con check, resumen de comentarios e imprimir con resumen; Expand/Collapse All | Gratis (Reader) |
| Comentar | Revisión compartida | "Send for Review" ("Send for Comment" en Mac): los comentarios de los revisores se juntan en un PDF con nombre y fecha; plazos y recordatorios | (plan no verificado) |
| Fill & Sign | Rellenar campos | Detecta campos automáticamente; autocompletado con entradas anteriores y perfil guardado; tamaño de texto ajustable; mover texto | Gratis (Reader) |
| Fill & Sign | Texto libre en PDF plano | Icono "Add Text" (Ab): clic y escribir, en formularios sin campos | Gratis (Reader) |
| Fill & Sign | Marcas | Checkmark, Crossmark, Dot (punto), Circle (rodear texto) y Line (tachar texto); detecta la casilla al pasar el ratón; la primera marca fija el tamaño de las siguientes | Gratis (Reader) |
| Fill & Sign | Firma | Sign > Add signature: Type (varios estilos manuscritos), Draw (ratón o lápiz) o Image (subir imagen); se guarda para reutilizarla; se coloca y escala | Gratis (Reader) |
| Fill & Sign | Iniciales | Mismo flujo que la firma ("Add initials") | Gratis (Reader) |
| Fill & Sign | Fecha | La documentación consultada no muestra un botón de fecha: se escribe con "Add Text" (hilos de la comunidad Adobe: no hay sello de fecha automático). La app móvil: (no verificado) | Gratis (Reader) |
| Fill & Sign | Salida | "Send a Copy" (copia no editable por enlace) y "Save a certified copy" (solo lectura con pista de auditoría). Al guardar con firma o iniciales ya no se pueden editar los campos | Gratis (Reader; plan de la copia certificada no verificado) |
| Fill & Sign | Solicitar firmas (Acrobat Sign) | Pedir, seguir y recordar firmas; Standard limitado (2 documentos/mes según la comunidad); Pro ilimitado más envío masivo, plantillas reutilizables, formularios web y branding | De pago (Standard+/Pro) |
| Fill & Sign | Firma digital con certificado | Digital ID autofirmado o emitido; firma de aprobación o certificación; se valida al abrir; no se puede en móvil (fuente secundaria: guías universitarias y Adobe) | Reader puede firmar con ID (fuente secundaria); resto (no verificado) |
| Editar PDF | Texto existente | Clic en el cuadro y panel Format: fuente, tamaño, color, alineación, interlineado; el párrafo se reajusta dentro de su cuadro (no pasa de página). Solo editable si la fuente está instalada (si solo está incrustada: solo color o tamaño); no se mueve texto entre páginas ni se rotan caracteres | Standard+ |
| Editar PDF | Auto-adjust layout | Modo que reajusta el contenido al editar (Experience League) | De pago (nivel no verificado) |
| Editar PDF | Añadir texto | Detecta fuente, tamaño, color y espaciado del texto cercano; fuente por defecto configurable | Standard+ |
| Editar PDF | Imágenes | Añadir, reemplazar, mover, redimensionar, voltear, recortar, rotar, alinear y ordenar | Standard+ |
| Editar PDF | Enlaces | Añadir/editar enlace, crear enlaces automáticos desde URL, apariencia del rectángulo | Standard+ |
| Editar PDF | Cabecera, pie y numeración | Header & Footer > Add: fuente, márgenes, varios por documento, guardar presets; numeración (5 formatos, "Page 1 of n", número inicial). "Page labels" cambia solo las etiquetas de miniaturas | Standard+ (no verificado) |
| Editar PDF | Marca de agua | Texto o archivo (PDF, JPEG, BMP); fuente, tamaño, color, opacidad, rotación; escala absoluta o relativa a la página; delante o detrás; posición; rango y subconjunto de páginas; mostrar al imprimir/en pantalla; variables de fecha y hora; guardar ajustes; aplicar a varios archivos | Standard+ (no verificado) |
| Editar PDF | Fondo | Color o imagen/PDF; añadir, actualizar y quitar | Standard+ (no verificado) |
| Editar PDF | Bates | Dígitos 3-15 (6 por defecto), número inicial, prefijo y sufijo; sobre archivos, carpetas o documentos abiertos | Pro (fuente secundaria) |
| Editar PDF | Botones y multimedia | Botones, audio, vídeo y objetos interactivos | Pro (fuente secundaria) |
| Editar PDF | Edición conversacional con IA | Reescribir y reemplazar texto, aplicar formato, gestionar resaltados con lenguaje natural (ago-2026); reorganizar páginas y añadir cabeceras, pies y marcas de agua por prompt (jun-2026) | Studio/add-on |
| Editar PDF | Diseño con Adobe Express | "Design a new page", "Stylize this PDF" y plantillas (cartel, redes, presentación; oct-2026) | (nivel no verificado) |
| Organizar páginas | Miniaturas | Seleccionar, arrastrar para reordenar (línea azul), cambiar tamaño de miniatura | Standard+ |
| Organizar páginas | Insertar | Desde archivo (hover en el borde de la miniatura y "+"), página en blanco, portapapeles, escáner o web | Standard+ |
| Organizar páginas | Eliminar, rotar, extraer | Papelera con confirmación; rotar izquierda/derecha; extraer a un PDF nuevo con opción de quitar del original o guardar como archivos separados (detalle de opciones: fuente secundaria) | Standard+ |
| Organizar páginas | Dividir | "Split by": número de páginas, tamaño de archivo o marcadores de nivel superior; carpeta de destino y etiquetado de archivos (Output Options) | Standard+ |
| Organizar páginas | Reemplazar y recortar | Reemplazar páginas con otro PDF; Crop Pages y Set Page Boxes | Standard+ (no verificado) |
| Organizar páginas | Combinar archivos | Combine Files: PDF, Word, Excel, PowerPoint, imágenes, correos; también desde escáner, web o portapapeles | Standard+ |
| Formularios | Prepare a Form | Auto-detecta campos (preferencia activada por defecto; falla en formularios complejos). Tipos (10): texto, casilla, radio, lista, desplegable, botón de acción, imagen, fecha, firma digital y código de barras (fuente secundaria) | Standard+ (nivel exacto por tipo: no verificado) |
| Formularios | Recopilar datos | Distribuir, recoger respuestas y compilarlas en una hoja de cálculo; formularios web y plantillas de firma reutilizables; formularios a partir de escaneos (requiere OCR) | Pro |
| Redactar | Marcar | Marcar texto e imágenes arrastrando; "Redact pages"; "Set properties": color de la caja, texto superpuesto, códigos US Privacy Act/FOIA | Pro |
| Redactar | Buscar y redactar | "Find text and redact": palabra, varios términos (listas importadas) y patrones (teléfono, tarjeta, email, número de la seguridad social de EE. UU.); resultados con casillas "Mark checked results for redaction" | Pro |
| Redactar | Sanitize y datos ocultos | "Sanitize document", "Remove hidden information" y "Selectively remove" (texto oculto, metadatos, comentarios, capas ocultas, adjuntos); se aplica con "Apply" y guardando (irreversible). Standard conserva la eliminación de información oculta (PCWorld) | Pro (la redacción); información oculta Standard+ (fuente secundaria) |
| Redactar | Redacción con IA | AI Assistant identifica y sugiere contenido sensible (notas ago/oct-2026) | Studio/add-on |
| Proteger | Contraseña y permisos | Contraseña de apertura y de permisos (restringir edición, impresión, copia); compatibilidad que fija el cifrado: RC4 128 (Acrobat 6+), AES 128 (7+), AES 256 (X+); cifrar todo o todo salvo metadatos (docs de Adobe LiveCycle; fuente secundaria). Quitar contraseña de documentos propios. La herramienta web gratuita solo pone contraseña de apertura | Standard+ (online gratis solo apertura) |
| Proteger | Cifrado con certificado | Cifrado de clave pública; "security envelope" y políticas de seguridad (no verificado) | Pro |
| Comprimir/optimizar | Compress a PDF | Archivo único o varios. Web: High, Medium, Low (la FAQ habla de presets pantalla/impresión estándar/impresión de calidad: inconsistente), hasta 2 GB, uso gratis limitado | Web gratis con límites; escritorio de pago (Standard+; no verificado) |
| Comprimir/optimizar | Advanced Optimization (PDF Optimizer) | Paneles Images (reducir resolución y compresión), Fonts (desincrustar), Transparency, Discard objects, Clean up; "Make compatible with" una versión de PDF; ajustes Standard/Custom guardables; "Audit space usage" (bytes por elemento); Action Wizard para lotes y "Optimize scanned documents" | Pro |
| Escanear y OCR | Scan & OCR | Escanear a PDF; "Recognize text" en este archivo o en varios (idioma por defecto de la configuración regional; documentos con varios idiomas son difíciles); "Enhance scanned file" (mejora de cámara/escáner); editar el texto reconocido. Número de idiomas: más de 40 según un blog de terceros (no verificado) | Pro |
| Comparar | Compare files | Vista lado a lado (Ctrl+\) y de una página; informe resumen con totales, distribución y formato; filtros por texto, imagen, anotaciones, formato, cabecera/pie y fondo; "Compare Text Only"; tipo de documento: informes/hojas (texto que reflota), presentaciones (páginas reordenadas) o escaneos/dibujos (se compara como imagen) | Pro |
| Exportar | Export a PDF | Word (DOCX), Excel (XLSX y XML), PowerPoint, imágenes (JPEG, PNG, TIFF), HTML, RTF, EPS, texto (plano o accesible) y PostScript; "Retain Page Layout" frente a texto fluido; también "Export All Images"; PDF a HTML accesible. Exportar a InDesign/Illustrator/AutoCAD: (no verificado) | Standard+ |
| Crear PDF | Create PDF | Desde archivo(s) (Word, Excel, PowerPoint, imágenes, correos), escáner, página web, portapapeles (File > Create > PDF from Clipboard) y página en blanco; PDF Portfolio (fuente antigua); crear PDF con contraseña desde Word/Excel/Outlook/PowerPoint; "Design a new page" | Standard+ |
| Medir | Measure | Herramientas Distance, Perimeter y Area; escala/ratio configurable (clic derecho > cambiar escala); tipos de ajuste (snap) | Pro (fuente secundaria: Mapsoft, UPDF) |
| Producción de impresión | Print production | Preflight (más de 400 comprobaciones; PDF/X, PDF/A, PDF/E), Output Preview (separaciones, soft proofing), Convert Colors, Ink Manager, Flattener Preview, Set Page Boxes, Add Printer Marks, Save as PDF/X, Edit Object, Fix Hairlines, Trap Presets | Pro |
| Accesibilidad | Accessibility | Accessibility Check (pasa/falla/revisión manual), Reading Order tool, paneles Tags y Content, Set Alternate Text, Autotag Document, guía "Make Accessible", formularios accesibles. Standard "puede mostrar pero no crear ni reparar" (Mapsoft) | Pro |
| Automatización | Action Wizard y herramientas personalizadas | Lotes de acciones guiadas ("guided actions") y comandos/herramientas personalizados; JavaScript | Pro |
| IA | AI Assistant | Resumen, preguntas y respuestas con citas clicables, preguntas sugeridas, generar textos, enlaces a pasajes; PDF Spaces (hasta 100 archivos, asistentes personalizados, compartibles); podcasts (13 idiomas); presentaciones; Adobe Express; edición conversacional y redacción asistida | Studio incluido; add-on para Pro; no en Reader |

### B.3 Herramientas web de Adobe (adobe.com/acrobat/online, acrobat.adobe.com)

- Adobe anuncia más de 25 herramientas gratuitas (con límites de uso no especificados) que se desbloquean al iniciar sesión. Sin iniciar sesión, los archivos se procesan en servidores de Adobe y se borran; iniciando sesión se pueden guardar y compartir. La FAQ de Compress afirma que la app de escritorio comprime en local.
- Catálogo (resumen del sitio): Generative AI (Chat with PDF, resumen, flashcards, quiz, mapa mental, presentación, currículum); a PDF (Word, Excel, PowerPoint, texto, RTF, JPG, PNG, HEIC, TIFF, BMP, GIF, captura, PSD, AI, InDesign); desde PDF (Word, Excel, PowerPoint, JPG, PNG); OCR; Compress; Edit; Merge; Split; Crop; Add text; Delete, Rotate, Reorder, Extract e Insert pages; Number pages; Fill & Sign; Form filler; Request e-signatures; Protect PDF. Export PDF y Compare no aparecen en esa lista.
- Límites documentados: Merge hasta 100 archivos, 500 págs por archivo y 1.500 págs en total; Split hasta 20 archivos de salida (19 divisores), 1.500 págs y 1 GB (en web se dividen con líneas; "por páginas, tamaño y marcadores" es de escritorio); Compress hasta 2 GB; Protect solo contraseña de apertura (con indicador de fuerza); PDF a Word con cuota diaria; Fill & Sign online: texto, marcas, círculos/puntos, líneas e iniciales, firma escrita/dibujada/imagen, sin fecha ni crossmark mencionados.

---

## C. Patrones de UX

### C.1 Acrobat (experiencia nueva; página de Adobe actualizada el 2026-04-23)

- Tres vistas: Home, All tools (catálogo de herramientas) y Document view (fuente secundaria: resumen del buscador de la ayuda "Workspace basics"). Home es la vista por defecto sin archivo abierto: recientes (locales y de la nube, con filtros de compartidos por ti, compartidos contigo y locales), Starred (copiados a la nube de Adobe), Scans, Shared by you / Shared by others y Agreements (e-sign), además de herramientas frecuentes, notificaciones y cuentas de almacenamiento (ayudas de Adobe vía buscador, de antigüedad mezclada).
- Barra global (fusiona barra de título y menús): a la izquierda herramientas PDF frecuentes (All tools, Edit, Convert, E-Sign), a la derecha acciones de archivo (Search, Save, Print, Share). En Windows, File/Edit/View se funden en un menú de hamburguesa; en macOS siguen separados.
- Panel izquierdo contextual: All tools lista las herramientas por categorías con búsqueda (el panel se reordena para mostrar la herramienta buscada; "View more" expande). Al elegir Edit, Convert o E-Sign se muestran las opciones de esa herramienta en el propio panel izquierdo; ej. Edit: "Modify page", "Add content" (Text, Image, Header and footer, Watermark, Link, Bates numbering, Button, multimedia, "more") y "Other options".
- Quick Action Toolbar: barra flotante en el documento, movible y personalizable (tres puntos/engranaje), con las herramientas de comentario y anotación más usadas; además, una mini barra contextual al seleccionar texto (resaltar, subrayar, tachar).
- Barra derecha ("right rail"): arriba Comentarios, Marcadores y Páginas (miniaturas); abajo contador y navegación de páginas, rotar, diseño de página y zoom. Se personaliza con clic derecho.
- Panel de comentarios: lista con filtros y orden, estado por comentario, respuestas, checks y resumen.
- Organizar páginas: cuadrícula de miniaturas con barra de herramientas (rotar, borrar con confirmación, extraer, dividir, reemplazar), "+" al pasar por el borde de una miniatura para insertar, línea azul al arrastrar.
- Panel de documento con menús contextuales que cambian según el contenido (texto, imagen, etc.).
- IA: AI Assistant como panel y barra flotante, prompts contextuales en la búsqueda, PDF Spaces. Crítica de usuarios (foro UserVoice y un sitio de reseñas, fuentes únicas): ventanas emergentes y avisos de mejora constantes y poco control para descartar el asistente.
- Se puede volver a la interfaz clásica con View > Enable/Disable new Acrobat (documentado en guías; vigencia en 2026 no verificada).
- Acrobat web: tarjeta por herramienta con "Try for free"; subir archivo, procesar, descargar o iniciar sesión para guardar.

### C.2 iLovePDF (flujo por herramienta)

- Home: rejilla de tarjetas agrupadas por categoría (Organize, Optimize, Convert to PDF, Convert from PDF, Edit, Security, Intelligence) con insignias "New" y "AI"; vista "All" y sección de Workflows.
- Página de herramienta: título y descripción de una línea; botón grande "Select PDF file" (o "Select PDF files"), "or drop PDFs here" y botones para importar de Google Drive y Dropbox. No hace falta cuenta.
- Espacio de trabajo tras subir: tarjetas de archivo con miniatura de portada (conmutador "Show-hide pdf covers"), botón "Order files by name", "+" para añadir más y arrastrar para reordenar; una barra lateral con las opciones de la herramienta (los textos exactos de sus títulos no se pudieron verificar) y un botón de acción grande y único (Merge PDF, Split PDF, COMPRESS PDF, CONVERT...).
- Herramientas visuales por página: Remove pages (clic en miniaturas, Shift para rangos, contadores "Total pages / Pages to remove"), Organize (arrastrar, "+" entre páginas), Crop (dibujar el área), Rotate (icono al pasar el ratón), Edit/Sign/Forms (editor completo con pestañas y panel de elementos).
- Procesamiento: pantalla de progreso con "Uploading file x of y", tiempo restante, velocidad y después un estado con verbo ("Merging PDFs...", "Compressing PDF...").
- Resultado: botón de descarga, guardar en Drive/Dropbox y QR para bajarlo en el móvil (blog de iLovePDF); borrado automático a las 2 h. Sugerencias de "siguiente herramienta" y botón de borrar ya: (no verificado).
- Monetización visible: insignias Premium sobre opciones concretas (pestaña Size de Split, "OCR Premium", "Advanced AI requiere créditos"), anuncios en Free y límites por tarea.
- Sin estado entre herramientas, salvo Workflows (hasta 4 pasos, requiere cuenta). "Reset all" en las herramientas con ajustes.
- Desktop: lector con pestañas, miniaturas, modo claro/oscuro, historial de tareas, recientes, menú contextual del explorador.

### C.3 Implicaciones para SnowPDF

- Combinar lo mejor de ambos: un visor/editor tipo Acrobat (barra derecha con miniaturas, marcadores y comentarios; barra flotante de anotación; mini barra al seleccionar texto) y un catálogo de herramientas por lotes tipo iLovePDF (arrastrar archivos, barra lateral de opciones, un botón de acción, resultado). Es exactamente lo que ya describe `docs/ARCHITECTURE.md` (features/home, features/tools, features/editor, features/organize).
- Sustituir el paso "subir, esperar, bajar" por "procesar y guardar como..." con progreso real (OCR y compresión tardan), botón Cancelar, vista previa y comparación de tamaño antes/después.
- Reutilizar el patrón de miniaturas con selección por clic y Shift y contadores para Eliminar, Extraer, Rotar y Dividir.
- Fill & Sign como modo ligero con barra fija: Texto, casilla, cruz, punto, círculo, línea, firma, iniciales y fecha (Acrobat no tiene botón de fecha: oportunidad de mejora).
- No copiar: avisos de mejora constantes, anuncios, cuotas, "Premium" y esperas. En una app personal offline no hacen falta.
- Panel de comentarios con filtro, orden, estado y respuestas; resumen de comentarios exportable.
- Un asistente de lote ("Workflows"/Action Wizard) como fase posterior: cadena corta de herramientas guardable.

---

## D. Lista maestra de funciones (sin duplicados)

### D.1 Criterios

- Orden: por la frecuencia con la que un usuario personal suele necesitar la función (juicio del analista, apoyado en la prominencia de las herramientas en iLovePDF y en lo que Adobe regala en Reader; no hay datos de uso verificados). Columna "Nivel": Esencial, Muy frecuente, Frecuente, Ocasional, Nicho.
- Dificultad estimada (stack web local: pdfjs-dist 6.4.299, @cantoo/pdf-lib 2.11.1, mupdf 1.28.1 WASM, shell Tauri 2/WebView2):
  - Baja: API directa de las librerías y UI sencilla.
  - Media: combinar librerías y/o construir una UI no trivial (miniaturas, edición visual, paneles) sin investigación.
  - Alta: algoritmos propios o integración pesada (WASM adicional, datos de idioma, binarios nativos); muchos casos límite.
  - Muy alta: fidelidad profesional difícil o sin solución local fiable (maquetación, normas ISO, IA); conviene delegar en un motor externo, diferir o descartar.
- Columna "En SnowPDF": lo que dicen docs/ARCHITECTURE.md y registry.ts (v0.1, v0.2, v0.3) o "-" si no figura (el código no se auditó).
- Notas de librerías relevantes: pdf.js 6.x (6.4.299, 3-oct-2026) ya trae editores (resaltar, texto libre, tinta, sello, firma, comentarios), organización de páginas, verificación de firma y relleno AcroForm; XFA parcial. @cantoo/pdf-lib: cifrado AES-256 con `encrypt()`, formularios (crear/rellenar/aplanar), adjuntos, `extractContents()`, `convertToPDFA()` (solo añade estructura, no reescribe el contenido), pero no extrae texto y las 14 fuentes estándar solo cubren WinAnsi (otros alfabetos requieren fuente incrustada). MuPDF 1.28: AGPL-3.0 (o licencia comercial de Artifex); WASM de unos 8-12 MB (3-4 MB comprimido); redacción real (`applyRedactions`), anotaciones de todos los tipos con apariencia generada, widgets de formulario, cifrado (`encrypt=aes-256`, `permissions`, contraseñas), `garbage`/`compress`/`objstms`, subset de fuentes, capas, etiquetas de página, adjuntos, `bake` (aplanar), outline, texto estructurado y búsqueda; `linearize` ya no funciona.

### D.2 Tabla

| # | Funcion | Origen | Nivel | En SnowPDF | Dificultad | Como hacerlo en local |
|---|---|---|---|---|---|---|
| 1 | Visor: abrir, scroll continuo, zoom/ajuste, miniaturas, marcadores, buscar, seleccionar y copiar texto, rotar vista, 1/2 páginas, pantalla completa, imprimir, recientes | Ambos | Esencial | v0.1 | Baja | pdfjs-dist (PDFViewer, find controller, outline, capa de texto y de formularios); impresión con el diálogo nativo de WebView2/Tauri. Pestañas con varios documentos: v0.2 (Baja-Media, es lógica de app). |
| 2 | Unir PDF (reordenar, ordenar A-Z, añadir archivos/imágenes) | Ambos | Esencial | v0.1 | Baja | `copyPages` de pdf-lib o `graftPage` de MuPDF; cuidar fusión de AcroForm (/DR, nombres duplicados) y marcadores (pdf.js tuvo que arreglar esos casos en su UI de fusionar). |
| 3 | Dividir (por rangos, cada N páginas, extraer páginas) | Ambos | Esencial | v0.1 | Baja | `copyPages` a documentos nuevos; parser de rangos "1-3, 5, 8-"; salida en ZIP con fflate. |
| 4 | Organizar páginas (reordenar, borrar, rotar, duplicar, insertar en blanco o de otro PDF, extraer, intercalar/mezclar) | Ambos | Esencial | v0.1 | Media | Modelo PageRef ya diseñado + miniaturas pdf.js + dnd-kit; exportar con pdf-lib. "Mix PDF pages" es solo un orden intercalado. |
| 5 | Comprimir (niveles Extremo/Recomendado/Bajo; ver tamaño antes y después) | Ambos | Esencial | v0.1 | Alta | MuPDF: `garbage=deduplicate`, `compress`, `compress-fonts`, `objstms` y subset de fuentes (sin pérdida: Baja) + reescritura de imágenes (la CLI de MuPDF tiene submuestreo por DPI y recompresión JPEG; su exposición en mupdf.js no está verificada: si falta, recomprimir imágenes con OffscreenCanvas y sustituir los streams). Perfiles propuestos: DPI 72-100/150/200-300 y calidad JPEG 40-50/65-75/85. |
| 6 | Rellenar formularios AcroForm y aplanar | Ambos | Esencial | v0.1 | Baja | pdf.js (capa de anotaciones + annotationStorage + `saveDocument`) y pdf-lib `form.flatten()` o `bake` de MuPDF. XFA solo parcial; cálculos JavaScript limitados. |
| 7 | Firmar (visual): dibujar, escribir, subir imagen; iniciales; fecha; guardar firmas | Ambos | Esencial | v0.1 | Media | Canvas para el trazo a PNG y `drawImage` de pdf-lib (o el editor de firma de pdf.js: Baja); "escribir" con fuentes manuscritas libres empaquetadas; guardar firmas localmente; fecha como texto en formato local. |
| 8 | Anotar: resaltar, subrayar, tachar, nota adhesiva, cuadro de texto, dibujo libre, formas, sellos | Ambos | Esencial | v0.1 parcial; v0.2 notas | Media | AnnotationEditor de pdf.js (resaltar, texto, tinta, sello, comentario) o anotaciones MuPDF con apariencia generada; guardarlas como anotaciones estándar para que se vean en otros lectores. |
| 9 | Panel de comentarios (filtrar, ordenar, responder, estado, resumen) | Acr | Muy frecuente | v0.2 | Media | Lista de anotaciones del documento con campos estándar (autor, fecha, contenido, estado); exportar el resumen a PDF/texto. |
| 10 | Imágenes a PDF (JPG/PNG y otros; orientación, tamaño Fit/A4/Carta, margen, unir) | Ambos | Esencial | v0.1 | Baja | `embedJpg`/`embedPng` de pdf-lib; WebP, HEIC, TIFF, BMP y GIF a través de Canvas o MuPDF; corregir rotación EXIF. |
| 11 | PDF a imágenes (JPG/PNG, DPI, rango) y extraer imágenes incrustadas | Ambos | Esencial | v0.1 (páginas) | Baja | Render con pdf.js o `toPixmap` de MuPDF a PNG/JPEG; extraer imágenes recorriendo XObjects (Media) o `extractContents()` del fork de pdf-lib. |
| 12 | Proteger con contraseña y permisos; desbloquear (contraseña conocida) | Ambos | Muy frecuente | v0.1 | Baja | `encrypt()` del fork de pdf-lib (AES-256, userPassword, ownerPassword, permissions) o `encrypt=aes-256` de MuPDF; desbloquear = abrir con la contraseña y guardar `encrypt=none`. Sin descifrado por fuerza bruta. |
| 13 | Office a PDF (Word, Excel, PowerPoint) | Ambos | Muy frecuente | v0.3 | Alta | No hay motor JS fiel. Delegar en Word por COM (`ExportAsFixedFormat`) o LibreOffice (`soffice --headless --convert-to pdf`) si están instalados, y avisar si no hay motor; empaquetar LibreOffice pesa cientos de MB. Muy alta si se quiere motor propio. |
| 14 | PDF a Word | Ambos | Muy frecuente | v0.3 | Muy alta | Reconstruir maquetación desde el texto estructurado de MuPDF (bloques, líneas, fuentes, imágenes) y generar DOCX con una librería; tablas por heurística. Alternativas: abrir el PDF con Word por COM (reflujo) o LibreOffice; fidelidad variable. |
| 15 | OCR (PDF escaneado a PDF buscable; idiomas) | Ambos | Muy frecuente | v0.2 | Alta | tesseract.js (WASM) con traineddata empaquetados (spa y eng como mínimo; "fast" frente a "best"), rasterizar a 200-300 DPI en worker, capa de texto invisible con pdf-lib o salida PDF de Tesseract (en v6 hay que activarla; opción exacta no verificada); detectar rotación e idioma. Alternativa nativa en Windows: `Windows.Media.Ocr` desde Rust (no verificado en esta sesión); ML Kit/Vision en móvil. |
| 16 | Marca de agua (texto/imagen, opacidad, rotación, mosaico, encima/debajo, rango) | Ambos | Muy frecuente | v0.1 | Baja | `drawText`/`drawImage` con `opacity` y `rotate`; "debajo del contenido" exige insertar el stream antes del /Contents existente (Media menor); mosaico = bucle. |
| 17 | Numerar páginas, cabeceras y pies, Bates | Ambos | Muy frecuente | v0.1 | Baja | `drawText` con plantilla {n}/{p}, posición, márgenes, inicio y rango; fuentes Unicode con fontkit; Bates = plantilla con contador, relleno de ceros, prefijo y sufijo. |
| 18 | Rotar páginas de forma permanente | Ambos | Muy frecuente | v0.1 | Baja | `setRotation` de pdf-lib (o rotación en PageRef). |
| 19 | Recortar páginas (CropBox) | Ambos | Frecuente | v0.1 | Baja | `setCropBox` (y MediaBox opcional); UI para dibujar el área en la página; aplicar a todas, actual o rango; autodetección de márgenes opcional con proyección de píxeles. |
| 20 | Añadir texto, imágenes, formas y enlaces (superpuestos) | Ambos | Muy frecuente | v0.1 | Media | Objetos overlay (EditorObject) dibujados con pdf-lib; enlaces como anotación Link (low-level o `createLink` de MuPDF). |
| 21 | Editar texto e imágenes existentes (como "Edit PDF" de Acrobat) | Ambos | Muy frecuente | v0.1 (tapar y reescribir) | Muy alta | El PDF no tiene reflujo: lo práctico es tapar y reescribir (MuPDF borra el contenido bajo la zona y pdf-lib dibuja el texto nuevo con una fuente equivalente). Edición real de runs requiere reescribir content streams y subsetting de fuentes; declarar límites (texto horizontal, fuentes disponibles). |
| 22 | Redactar (marcar y aplicar, buscar patrones, sanitizar metadatos y datos ocultos) | Ambos | Frecuente | v0.1 | Media | MuPDF: anotación Redact + `applyRedactions()` (elimina texto, imágenes y vectores bajo el área; irreversible); buscar con texto estructurado + regex (email, teléfono, tarjeta con Luhn, IBAN, DNI/NIE); sanitizar: borrar metadatos/XMP, anotaciones, adjuntos, JS y capas; si no hay texto, OCR primero. |
| 23 | Comparar dos PDF (texto y visual) | Ambos | Frecuente | v0.2 | Media | Texto por página (MuPDF o `getTextContent` de pdf.js) + diff (jsdiff/diff-match-patch) con informe; superposición con render a canvas y diferencia de píxeles coloreada; scroll sincronizado. |
| 24 | Reparar PDF dañado | iLP | Frecuente | v0.1 | Baja | MuPDF reconstruye la xref al abrir (`wasRepaired()`) y se regraba limpio; el fork de pdf-lib recupera PDFs truncados; mostrar informe. |
| 25 | Metadatos (título, autor, palabras clave, productor) y limpieza para privacidad | iLP Desktop/Acr | Frecuente | v0.1 | Baja | `setTitle`, `setAuthor`... de pdf-lib; XMP con MuPDF o low-level; cuidado con PDF/A (Info y XMP deben coincidir). |
| 26 | Aplanar anotaciones y formularios | Acr | Frecuente | v0.1 | Baja | `form.flatten()` de pdf-lib y `bake` de MuPDF. |
| 27 | Marcadores/índice (ver, editar) y enlaces internos | Acr | Frecuente | v0.2 | Media | Ver: `getOutline` de pdf.js. Editar: `OutlineIterator` de MuPDF (insertar, borrar, renombrar); autogenerar desde encabezados por tamaño de fuente (opcional). |
| 28 | Dividir avanzado (por tamaño, por marcadores, por páginas en blanco o palabra clave) | Ambos | Frecuente | - | Media | Por tamaño: iterar y medir bytes tras guardar; por marcadores: outline de MuPDF; por páginas en blanco: render + umbral de píxeles; por palabra clave: búsqueda de texto. Alternativa local, sin IA, al "Smart Split". |
| 29 | HTML a PDF | iLP | Ocasional | - | Media | `PrintToPdfAsync` de WebView2 (Rust) con opciones de tamaño, orientación y márgenes; solo archivos HTML locales (offline); no aplican bloquear anuncios/popups. |
| 30 | Crear formularios (campos: texto, casilla, radio, lista, desplegable, botón, firma, fecha) | Ambos | Ocasional | - | Media | `createTextField`, `createCheckBox`, `createRadioGroup`, `createDropdown`, `createOptionList` y botón de pdf-lib + UI de colocación y propiedades (obligatorio, solo lectura, multilínea); campos de firma/fecha/código de barras con low-level. |
| 31 | Autodetectar campos en PDF plano ("Detect with AI") | Ambos | Ocasional | - | Muy alta | Heurística con líneas, cajas y subrayados del operator list (MuPDF/pdf.js) o modelo ONNX local; calidad variable (hasta Acrobat falla en formularios complejos). |
| 32 | PDF a Excel y a PowerPoint | Ambos | Ocasional | v0.3 (Excel) | Muy alta | Excel: detección de tablas por líneas y alineación de texto con MuPDF; PowerPoint: una diapositiva por página con imagen de fondo y texto superpuesto (baja editabilidad) o LibreOffice. |
| 33 | PDF a texto, HTML, Markdown | Ambos | Ocasional | texto: futuro | Media | `asText`/`asHTML` de MuPDF o `getTextContent` de pdf.js; Markdown con heurísticas de estructura (tamaño de fuente a encabezados, listas); tablas son Alta. |
| 34 | PDF/A (convertir y validar) | Ambos | Ocasional | v0.3 | Muy alta | El fork de pdf-lib `convertToPDFA()` solo añade estructura; el cumplimiento real exige incrustar fuentes, perfiles ICC, quitar transparencia/cifrado/JS. Ghostscript como sidecar (AGPL) o validación con veraPDF (Java). |
| 35 | Firma digital con certificado (PKCS#7/PAdES) y verificar firmas | Ambos | Ocasional | - | Alta | Firmar: reservar /ByteRange y firmar CMS con un PFX local (librería JS o crate de Rust); sin sello de tiempo offline. Verificar: el visor de pdf.js 6.2+ ya verifica firma y certificado (release notes); la cadena de confianza puede usar el almacén de certificados de Windows vía Rust. |
| 36 | Escanear a PDF (escáner o móvil) y mejorar escaneos | Ambos | Ocasional | - | Alta | Windows: WIA/TWAIN desde Rust o NAPS2 CLI; móvil: página de captura servida en la red local con QR, o la app móvil de SnowPDF; mejora (recorte, enderezado, B/N) con OpenCV.js; luego OCR. |
| 37 | Capas, adjuntos y etiquetas de página (ver y editar) | Acr | Ocasional | - | Baja | pdf.js (visores de capas y adjuntos); MuPDF (capas, archivos incrustados, `setPageLabels`); pdf-lib `attach`. |
| 38 | Búsqueda en varios PDF (índice local) | Acr | Ocasional | - | Alta | Indexador local (MiniSearch/FlexSearch) alimentado por texto extraído en segundo plano; detalle de Acrobat (índices y Advanced Search): (no verificado). |
| 39 | Leer en voz alta | Acr | Ocasional | - | Baja | Acrobat lo ofrece en View > Read Out Loud (esta página o hasta el final). Local: Web Speech API o voces SAPI offline de Windows con el orden de lectura de pdf.js; TTS nativo en móvil. |
| 40 | Imprimir con opciones (N por hoja, folleto, escala, con anotaciones) | Acr | Ocasional | - | Media | Diálogo nativo + composición previa con pdf-lib (N-up, folleto); "booklet" en Acrobat: (no verificado). |
| 41 | Lotes y flujos (encadenar herramientas, aplicar a carpeta) | iLP Workflows / Acr Action Wizard | Ocasional | - | Media | Cola de tareas sobre archivos (Tauri fs) con presets; reutilizar el registro de herramientas (BatchToolDef). |
| 42 | Medir (distancia, perímetro, área con escala) | Acr | Nicho | - | Media | Herramienta de canvas con calibración de escala (dos puntos + longitud real); cálculo en puntos PDF. |
| 43 | Resumir, traducir, chat y "Smart" (Smart Split, Smart Redact) con IA | Ambos | Ocasional | - | Muy alta | LLM/NMT locales (llama.cpp, Ollama u ONNX/WebGPU) sobre el texto extraído; traducir conservando el diseño es el caso más difícil. Dejar como módulo opcional descargable y tardío. |
| 44 | Producción de impresión (Preflight, separaciones, tinta, PDF/X) | Acr | Nicho | - | Muy alta | Fuera de alcance personal; Ghostscript para separaciones solo si algún día hiciera falta. |
| 45 | Accesibilidad (etiquetado, orden de lectura, texto alternativo, comprobador) | Acr | Nicho | - | Muy alta | Requiere crear y editar StructTreeRoot; MuPDF conserva o descarta la estructura (opción `--structure` de la CLI: keep o drop); limitar a mostrar etiquetas. |
| 46 | Multimedia, JavaScript y objetos interactivos | Acr | Nicho | - | Muy alta | pdf.js ejecuta JS en un sandbox (solo reproducir); crear contenido interactivo no compensa. |
| 47 | Nube, revisión compartida, e-sign multiparte, PDF Spaces, Adobe Express | Ambos | Nicho | - | No aplica | Incompatibles con "100 % offline"; sustituir por exportar y enviar manualmente. |

### D.3 Sugerencia de fases (a partir de la tabla)

- Primero (valor alto, riesgo bajo o medio): filas 1 a 4, 6 a 12, 16 a 20, 22 y 24 a 26; de la fila 5, la parte sin pérdida (garbage, compresión de streams, subset de fuentes).
- Después (valor alto, esfuerzo alto): comprimir con reescritura de imágenes (5), Office a PDF delegado (13), OCR (15), comparar (23), marcadores (27), división avanzada (28), crear formularios (30) y firma digital (35).
- Diferir o evaluar con cuidado: PDF a Word/Excel/PowerPoint (14, 32), PDF/A (34), IA (43), autodetección de campos (31).
- Descartar: producción de impresión, accesibilidad avanzada, multimedia y nube (44 a 47).

### D.4 Riesgos transversales

- Licencia: MuPDF es AGPL-3.0 (el wrapper y el WASM); uso personal sin problema, pero distribuir SnowPDF obliga a liberar el código o comprar licencia de Artifex. Ghostscript también es AGPL. pdf.js es Apache-2.0 y pdf-lib es MIT.
- pdf-lib original: última versión 1.17.1 el 6-nov-2021; el fork @cantoo/pdf-lib 2.x es el que se mantiene (su README dice que lo mantendrán mientras lo necesiten).
- Memoria: MuPDF.js necesita `destroy()` explícito (la memoria WASM no se recolecta); PDFs de cientos de MB pueden agotar la memoria de WebAssembly: procesar en workers y, si hace falta, en el lado Rust de Tauri.
- Coherencia entre motores: pdf.js renderiza y MuPDF escribe/rasteriza; conviene una sola fuente de verdad de bytes en claro (ya contemplado en ARCHITECTURE.md) y pruebas de ida y vuelta con PDFs reales (formularios, cifrados, escaneados).
- Fuentes: las 14 estándar solo cubren WinAnsi; para otros alfabetos incrustar TTF con fontkit.

---

## E. Fuentes consultadas

iLovePDF
- https://www.ilovepdf.com/ (home) y páginas de herramienta: /merge_pdf, /split_pdf, /remove-pages, /organize-pdf, /scan-pdf, /compress_pdf, /repair-pdf, /ocr-pdf, /jpg_to_pdf, /word_to_pdf, /powerpoint_to_pdf, /excel_to_pdf, /html-to-pdf, /pdf_to_jpg, /pdf_to_word, /pdf_to_powerpoint, /pdf_to_excel, /convert-pdf-to-pdfa, /rotate_pdf, /add_pdf_page_number, /pdf_add_watermark, /crop-pdf, /edit-pdf, /pdf-forms, /unlock_pdf, /protect-pdf, /sign-pdf, /redact-pdf, /compare-pdf, /pdf-summarize, /translate-pdf, /pdf-to-markdown
- https://www.ilovepdf.com/pricing, /desktop, /features, /blog (índice y artículos: organize-pdf-pages, new-advanced-pdf-editing-ilovepdf, automate-pdf-tasks-with-ilovepdf-workflows, ai-split-pdf-smart-range-mode, pdf-forms-fillable-pdf-tool-ai-detect, how-to-redact-pdf, offline-pdf-editor-ilovepdf-desktop, direct-mobile-download)
- https://www.iloveapi.com/docs/api-reference (parámetros de herramientas)
- https://www.qt.io/development/ilovepdf-built-with-qt (referencia vía buscador)

Adobe
- https://www.adobe.com/acrobat/pricing.html, /acrobat/pricing/compare-versions.html, /products/reader/, /acrobat/pdf-reader.html, /acrobat/features.html, /acrobat/acrobat-pro.html, /acrobat/online.html y /acrobat/online/* (compress-pdf, split-pdf, merge-pdf, password-protect-pdf, pdf-to-word, sign-pdf), /acrobat/resources/how-to-redact-a-pdf.html
- https://www.adobe.com/learn/acrobat/web/* (fill-sign-pdf-form, fill-and-sign-pdf-forms, gather-feedback-pdf-comments)
- https://experienceleague.adobe.com/en/docs/document-cloud-learn/acrobat-learning/* (overview, get-started, advanced-tasks: redact, compare, reduce, optimizescan; accessibility-overview; ai-overview)
- https://www.adobe.com/devnet-docs/acrobatetk/tools/ReleaseNotesDC/continuous/ (notas jun-2026 y oct-2026)
- helpx.adobe.com: solo a través de resúmenes del buscador (WebFetch devolvió 403): commenting-pdfs, fill-and-sign, organize pages, add-headers-footers-pdfs, apply bates, add-watermarks, comments, compare-documents, print-production-tools-overview, certificate-based-signatures, optimizing-pdfs, release notes de escritorio
- Terceros: PCWorld (Standard frente a Pro), Mapsoft (Reader/Standard/Pro), comunidad Adobe (diferencias Standard y Pro, Fill & Sign sin fecha), SVSU (descripción de la UI nueva), TAMU/Exeter/YSU (accesibilidad), UPDF/Swifdoo (Measure), UserVoice y reseñas (críticas de UX)

Librerías
- https://github.com/mozilla/pdf.js/releases (v5.4 a v6.4.299)
- https://github.com/ArtifexSoftware/mupdf.js, https://mupdfjs.readthedocs.io (FAQ y referencia), https://mupdf.readthedocs.io/en/1.28.0/ (PDF Write Options, mutool clean, PDFDocument)
- https://unpkg.com/@cantoo/pdf-lib@2.11.1/README.md y 2.7.1; resumen de mantenimiento de pdf-lib (depscope/snyk)
- Proyecto: C:\Users\Usuario\SnowPDF\docs\ARCHITECTURE.md, C:\Users\Usuario\SnowPDF\src\features\tools\registry.ts y package.json
