# Análisis de Adobe Acrobat como inspiración de diseño para SnowPDF

> Fecha del análisis: 2026-10-26 · Equipo: Windows 11 · Documento hermano: `docs/ARCHITECTURE.md`
>
> **Marcas de evidencia usadas en este documento**
>
> - **(inferido por el nombre)**: deducido únicamente del nombre de un archivo o carpeta. Puede ser incorrecto.
> - **[VER]**: metadatos de versión de Windows (descripción/versión del archivo). Es información que Adobe publica en el propio ejecutable.
> - **[SDK]**: documentación pública del SDK de Acrobat/PDF Library (opensource.adobe.com).
> - **[ADMIN]**: documentación pública del Acrobat Enterprise Toolkit (adobe.com/devnet-docs/acrobatetk).
> - **[AYUDA]**: ayuda pública de Adobe (helpx / Experience League). Ojo: `helpx.adobe.com` devolvió HTTP 403 a la herramienta de descarga, así que muchas páginas se leyeron a través de **resúmenes de buscador**; son menos fiables que una lectura directa (ver §1.3).
> - **[QS]**: guías rápidas PDF publicadas por Adobe (Acrobat XI, 2012).
> - **[COM]**: tutoriales o respuestas de comunidad/terceros (acrobatusers.com, universidades...). Se usan solo para contrastar.

---

## 0. Resumen ejecutivo

- **Producto instalado:** *Adobe Acrobat (64-bit)* **26.002.22031** (archivo `Acrobat.exe` 26.2.22031.0), en `C:\Program Files\Adobe\Acrobat DC\`. Es el **instalador unificado** de Adobe: Reader y Acrobat Standard/Pro comparten ejecutable y las funciones se activan por licencia [ADMIN]. **Por los nombres de archivo no se puede saber si es Reader gratuito o Pro**.
- **Arquitectura observada:** núcleo nativo grande (`Acrobat.dll`, ≈88 MB) + **25 plug-ins `.api`** (≈80 MB) + librerías gráficas compartidas de Adobe (AGM, CoolType, ACE...) + **capa de interfaz web** (Chromium Embedded Framework `AcroCEF` 229 MB + `WebResources` 414 MB = **53 % del tamaño total de 1,2 GB**) + procesos auxiliares (brokers de plug-ins, sincronizador de colaboración, actualizador como servicio de Windows + tarea programada, crash reporter, licencias).
- **Modelo de capas del SDK público:** Cos (objetos PDF) → PD (documento/página/anotación) → PDFEdit/PDSEdit (contenido físico/estructura lógica) → AV (UI) + AS (utilidades y sistema de ficheros reemplazable); los módulos se cargan por *handshake* en tres fases y se hablan mediante **tablas de funciones (HFT)** versionadas y reemplazables.
- **Lo más trasladable a SnowPDF** no es el código (que no se toca) sino los **comportamientos**: umbral de submuestreo 1,5×, tabla de calidades JPEG, listas de "descartar objetos/datos", sanitizado con casillas, marcar-y-aplicar en redacciones, patrones regex por región, paridad de permisos de cifrado, tres modos de OCR, comparación por texto y por píxel, y secuencias encadenables ("Action Wizard").
- **Top 5 de mejoras propuestas (detalle en §6):** (1) Sanitizar / quitar información oculta, (2) redacción en dos fases con búsqueda por patrones y pack es-ES, (3) paridad de opciones de *Proteger*, (4) almacén de presets JSON declarativos, (5) optimizador real con submuestreo de imágenes y auditoría de espacio.

---

## 1. Alcance, método y límites

### 1.1 Qué se hizo

- Localizar la instalación y leer **solo**: nombres de carpetas y archivos, tamaños y recuentos, **metadatos de versión de Windows** (`VersionInfo`), el nombre/versión del producto en la lista de programas instalados de Windows, y el **estado** (no el contenido) de servicios, tareas programadas y procesos en ejecución con nombre Adobe.
- Leer documentación pública de Adobe (SDK, guía de administración, ayuda, guías rápidas) y documentación abierta de MuPDF/pdf-lib para aterrizar las ideas en la pila de SnowPDF.
- Leer (solo lectura) `docs/ARCHITECTURE.md`, `package.json`, `src/features/tools/registry.ts`, `src/model/types.ts`, `src/pdf/fonts.ts` y los `.d.ts`/documentación de MuPDF.js ya instalados en `node_modules`.

### 1.2 Qué NO se hizo

- No se abrió ni leyó el **contenido** de ningún `.exe`, `.dll`, `.api`, `.js`, `.html`, `.css`, `.bin`, `.pak`, `.xml`, `.sequ`, recursos, etc. No se desensambló, no se extrajeron recursos, **no se copió** código, scripts, imágenes, iconos ni textos propietarios de Adobe al proyecto.
- No se lanzó Acrobat (no estaba abierto) ni se modificó nada en las carpetas de Adobe.
- Los patrones de ejemplo, esquemas JSON y algoritmos de este documento son **diseño propio**.
- Fuera del proyecto, la herramienta de descarga guardó automáticamente dos guías rápidas públicas de Adobe (PDF) en su carpeta temporal; el texto extraído se usó solo para este análisis.

### 1.3 Fuentes y fiabilidad

- `helpx.adobe.com` **bloquea la descarga directa (403)**. Para esas páginas se usaron resúmenes de buscador (etiquetados **[AYUDA]**), Experience League (accesible, pero son sobre todo vídeos con poco texto), las guías rápidas PDF de Adobe **[QS]**, el blog de Adobe, el SDK **[SDK]** y la guía de administración **[ADMIN]** (estas tres sí se leyeron directamente).
- Recomendación: antes de copiar un valor numérico de **[AYUDA]/[COM]** a producción, **verificarlo en la página original** (lista de URLs en §8) o con una prueba propia.
- Para ver las descripciones oficiales de cada plug-in en tu máquina: *Ayuda → Acerca de los plug-ins de Adobe Acrobat* (no se hizo aquí porque implica lanzar la aplicación).

---

## 2. Instalación encontrada

| Campo | Valor |
|---|---|
| Producto | **Adobe Acrobat (64-bit)**, instalador unificado Reader/Acrobat |
| Versión (lista de programas) | **26.002.22031** |
| Versión de archivo (`Acrobat.exe`, `Acrobat.dll`, plug-ins) | 26.2.22031.0 (algunos módulos conservan 26.1.x o 26.2.21901 [VER]) |
| Notas de versión públicas | "26.002.22031 (actualización planificada 14-oct-2026)", con un único arreglo de estabilidad listado [ADMIN] |
| Ruta | `C:\Program Files\Adobe\Acrobat DC\Acrobat\` (la raíz `Acrobat DC` coincide con la ruta por defecto del instalador unificado [ADMIN]) |
| Edición (Reader / Standard / Pro) | **No determinable por archivos.** El instalador unificado usa "un ejecutable y un hive de registro compartidos"; las funciones de Acrobat se desbloquean por licencia (Named User / Federated ID) y sin ella se ofrecen las básicas de Reader [ADMIN]. Indicios sueltos: existe `Try_premium_features.pdf` y `acrobat_reader_appicon_16.png` (inferido por el nombre). |
| Tamaño | 7.297 archivos, ≈1.221 MB (en raíz: 83 archivos, 289 MB; 16 `.exe` y 52 `.dll`) |
| Idiomas | `Locale` solo `en_US` y `es_ES`; `Legal` trae avisos en 32 idiomas |
| Procesos residentes (Acrobat cerrado) | `AdobeCollabSync` ×2, `AcrobatNotificationClient` ×1; servicio de Windows **Adobe Acrobat Update Service** (en ejecución) y tarea programada **Adobe Acrobat Update Task** (lista) |
| Componentes "opcionales" | La guía de administración dice que Preflight, el plug-in 3D, XPS2PDF, Multimedia y AutoCAD PDFM **no se instalan por defecto** [ADMIN]. Aquí no hay Preflight (coherente) pero sí `plug_ins3d` y `Multimedia`, así que la lista de la guía puede estar desfasada o se instalaron. |

---

## 3. Estructura interna observada

### 3.1 Mapa de carpetas (bajo `Acrobat DC\Acrobat\`)

| Carpeta | Archivos | MB | Para qué sirve (evidencia) |
|---|---:|---:|---|
| *(raíz)* | 83 | 289 | `Acrobat.exe`, `Acrobat.dll`, `AcrobatRes.dll` y librerías compartidas (§3.3) |
| `plug_ins\` | 56 | 100 | 25 plug-ins `.api` (80 MB), DLL de OpenSSL/MIP y subcarpetas `AcroForm`, `Annotations`, `Multimedia`, `pi_brokers` |
| `plug_ins3d\` | 8 | 5,6 | Runtime 3D: módulos `.x3d` (2D, DX9, DX11, software, PRC) [VER] |
| `RdrTools\` | 32 | 104 | `AdobePDFL.dll`, `acroML.dll`, ONNX Runtime, boost, carpeta `models` (ver §3.7) |
| `AcroCEF\` | 25 | 229 | **Chromium Embedded Framework** (`libcef.dll` 168 MB) |
| `WebResources\` | 6.698 | 414 | Aplicación web de la interfaz: `Resource2` (2.541 archivos) y `SA` (4.157) |
| `x86\` | 14 | 27,5 | Juego de librerías de **32 bits** + `Acrobat.exe` de 32 bits (inferido: para complementos de Office/Outlook de 32 bits) |
| `Locale\` | 44 | 10,5 | Un recurso `.ESP` por módulo (inferido por el nombre) |
| `Assets\` | 82 | 12,7 | Imágenes/GIF de avisos e interfaz + `MenuCoreApp` (menú contextual de Windows 11) |
| `OSSLLibs\` | 2 | 10,1 | Módulo criptográfico FIPS (`AdobeFips.exe`, `fips-adobe.dll`) [VER] |
| `NGL\`, `ngl_resources\` | 2 + 7 | 4,1 + 4,4 | Flujo de licencias con interfaz web propia (inferido por el nombre; NGL = *next-gen licensing*) |
| `DocSettings\Redaction\` | 9 | <0,1 | Juegos regionales de patrones y de códigos de redacción: `CAN, DEU, ENU, FRA, JPN, UK` (nombres) |
| `Sequences\` | 12 | ~0 | 6 secuencias `.sequ` × 2 idiomas: acciones de **Action Wizard** (inferido por el nombre) |
| `UIThemes\`, `UICustomization\` | 2 + 5 | ~0 | Temas `DarkTheme/LightTheme.acrotheme`; personalización `.aaui` (inferido) |
| `DocTemplates\`, `IDTemplates\`, `HostedServicesTemplates\`, `Tutorials\` | 6 + 4 + 1 + 2 | 1,3 | Plantillas y PDF de muestra; `IDTemplates` = plantillas de ID visual de firma (inferido) |
| `RdrApp\` | 108 | 0,2 | 108 descriptores `.aapp` por idioma (inferido por el nombre) |
| `Javascripts\` | 2 | 3,5 | `JSByteCode*.bin`: JavaScript precompilado (inferido por el nombre) |
| `Tracker\` | 41 | ~0 | GIF/CSS del "Rastreador" de revisiones y formularios (inferido) |
| `Air\`, `Browser\` | 2 + 4 | 0,9 | Plug-in de navegador heredado `nppdf32` y *host* de mensajería nativa de la extensión de Chrome |
| `CrashReporterResources\`, `RDCNotificationClient\`, `Legal\` | 8 + 3 + 34 | 4,6 | Interfaz del informe de fallos, paquete de notificaciones (MSIX), avisos legales |

Distribución por tipo: 97 `.dll` (518 MB), 2.894 `.png` (162 MB), 273 `.webm` (119 MB), 28 `.exe` (102 MB), 2.363 `.js` (89 MB), 25 `.api` (80 MB), 157 `.gif`, 51 `.otf`, 47 `.esp`.

### 3.2 Ejecutables y procesos (raíz, por nombre y descripción de versión)

| Ejecutable | Tamaño | Función |
|---|---:|---|
| `Acrobat.exe` | 6,6 MB | Lanzador/host principal; la lógica vive en `Acrobat.dll` [VER] |
| `acrobat_sl.exe` | 42 KB | "SpeedLauncher": arranque rápido/precarga [VER] |
| `AcrobatInfo.exe` | 36 KB | Utilidad de información (inferido por el nombre) |
| `AcroBroker.exe` | 4,3 MB | **Broker de PDF para Internet Explorer** (proceso privilegiado intermediario) [VER] |
| `AcroTextExtractor.exe` | 62 KB | Extractor de texto de archivos **no PDF**, fuera de proceso [VER] |
| `AdobeCollabSync.exe` | 43,5 MB | Sincronizador de colaboración/revisiones; **residente** [VER] |
| `ADNotificationManager.exe` | 0,8 MB | Notificaciones [VER] |
| `Adobe Crash Processor.exe`, `CRLogTransport.exe`, `CRWindowsClientService.exe`, `LogTransport2.exe` | 0,2-1,5 MB | Cadena de **informes de fallos y registro** (servicio + transporte + procesador) [VER] |
| `WebViewInstaller.exe` | 1,7 MB | Instalador del runtime **Edge WebView2** [VER] → segundo motor web además de CEF |
| `ShowAppPickerForPDF.exe`, `Eula.exe`, `CPInstCU.exe`, `ADelRCP.exe` | 0,1-0,4 MB | Selector de aplicación PDF predeterminada, EULA, instalador por usuario (inferido), utilidad sin descripción clara |
| `AcroCEF\AcroCEF.exe` | 3,6 MB | Proceso auxiliar de Chromium (la ayuda de Adobe confirma que gestiona red y servicios de Document Cloud, p. ej. Fill & Sign y revisión compartida, y que no se puede desactivar) [AYUDA] |
| `plug_ins\pi_brokers\*.exe` | 0,1-0,6 MB | `32BitMAPIBroker`, `64BitMAPIBroker` (correo) y `MSRMSPIBroker` (AIP/RMS): son los "plugin brokers" que describe el SDK (§4.3) |
| `NGL\cefWorkflow\adobe_licensing_wf_*.exe` | 3,7 + 0,4 MB | Flujo de licencias con su propio CEF (inferido por el nombre) |
| `OSSLLibs\AdobeFips.exe` | 6,2 MB | Módulo FIPS de OpenSSL [VER] |
| `AcroCEF\SingleClientServicesUpdater.exe` | 19 MB | (inferido por el nombre) actualiza los "servicios de cliente"/recursos web de forma independiente al instalador nativo |

Servicios auxiliares fuera de la carpeta: **ARM** (`AdobeARM.exe`, `armsvc.exe`, `AdobeARMHelper.exe` en `Common Files (x86)\Adobe\ARM`) = actualizador como **servicio de Windows + tarea programada**, y complementos de integración con Windows (`AcroPDF.dll` ActiveX, `PDFPrevHndlr.dll`, `adobeafp.dll`, menú contextual de Windows 11 `MenuCoreApp`).

### 3.3 Núcleo y librerías compartidas

- **Núcleo:** `Acrobat.dll` (87,7 MB) y `AcrobatRes.dll` (32,3 MB, recursos) [VER].
- **Gráficos, tipografía, color, imagen** (marca "Adobe shared technology"): `AGM.dll` (Adobe Graphics Manager, 13 MB), `CoolType.dll` (tipografía), `ACE.dll` (Adobe Color Engine), `AIDE.dll` (decodificador/codificador de imagen), `JP2KLib.dll` (JPEG2000), `pe.dll` (motor de proyecciones geoespaciales), `BIB/BIBUtils/pdfport.dll` ("Bravo Interface Binder", capa de enlace; inferido por el nombre) [VER].
- **XML/metadatos/texto:** `AdobeXMP.dll` (XMP Core 9.1), `AXE8SharedExpat.dll`, `AXSLE.dll` (XSLT), `AdobeLinguistic.dll`, `Onix.dll` ("Onix - Lextek": motor de indexación/búsqueda de texto) [VER], `sqlite.dll`, **ICU 71**.
- **Scripting:** `ScCore.dll` y `ExtendScript.dll` (motor de scripts) [VER], más `Javascripts\*.bin`.
- **Cripto y protección:** OpenSSL 3.5.8 (+ módulo FIPS), `libcrypto-4-x64.dll` (OpenSSL 4.0.2 en `RdrTools`), `cryptocme.dll`/`ccme_*` (inferido por el nombre: módulo criptográfico comercial), SDK **Microsoft Information Protection** 1.18.75 (`mip_*.dll`) para etiquetas AIP [VER].
- **Otros:** `adobe_c2pa.dll` (credenciales de contenido C2PA; inferido por el nombre), `thorvg-1.dll` (gráficos vectoriales ligeros; inferido), `DirectInk.dll` (escritura a mano/lápiz), `A3DUtils/rt3d` (3D), `AcroCloudConnect.dll`, `AdobeGrowthSDK.dll`, `logsession.dll`.

### 3.4 Plug-ins `.api` (25) y qué aportan

Carga: el SDK dice que Acrobat busca en la carpeta `plug_ins` junto al ejecutable **y un nivel de subcarpetas** [SDK]; coincide con `AcroForm\`, `Annotations\`, `Multimedia\` y `pi_brokers\`.

| Módulo | MB | Función probable | Evidencia |
|---|---:|---|---|
| `AcroForm.api` | 19,7 | Formularios AcroForm: campos, rellenado, JS de formularios; códigos de barras 2D (carpeta `PMP`) | [VER]; [SDK]: el plug-in de formularios exporta su propia HFT |
| `Annots.api` | 13,4 | Anotaciones y comentarios: notas, resaltado, dibujo, sellos | [VER]; [SDK]: manejadores de anotación |
| `PPKLite.api` | 13,2 | Seguridad de clave pública y certificados (el nombre coincide con el manejador `Adobe.PPKLite` de la especificación PDF) | [VER] |
| `TouchUp.api` | 11,5 | "Retoque": edición de texto y objetos; base de *Editar PDF* | [VER] + (inferido por el nombre) |
| `MakeAccessible.api` | 6,5 | Hacer accesible/etiquetar | [VER] |
| `EScript.api` | 3,7 | JavaScript de Acrobat (objetos `app`, `Doc`, `Field`, `util`...) | [VER]; referencia JS pública en [SDK] |
| `Multimedia.api` | 1,7 | Multimedia heredada; reproductores `.mpp` (MCI, Windows Media) | [VER] + nombres de subcarpeta |
| `DigSig.api` | 1,6 | Servicio genérico de firma digital sobre el que se registran manejadores | [VER] |
| `StorageConnectors.api` | 1,1 | Conectores de almacenamiento en la nube | [VER] |
| `Checkers.api` | 1,0 | Comprobadores (accesibilidad u otros; sin doc. pública localizada) | [VER] + (inferido por el nombre) |
| `MSRMS.api` | 1,0 | Protección Microsoft AIP/RMS (con `MSRMSPIBroker.exe` y `mip_*.dll`) | [VER] |
| `Accessibility.api` | 0,7 | Accesibilidad con lectores de pantalla | [VER] |
| `Search.api` | 0,6 | Búsqueda en documentos e índices (con `Onix.dll` y *stopwords* por idioma) | [VER] + (inferido por el nombre) |
| `SendMail.api` | 0,6 | Enviar por correo (MAPI; brokers de 32/64 bits) | [VER] |
| `SaveAsRTF.api` | 0,5 | Exportar a RTF/Word | [VER] |
| `PDDom.api` | 0,5 | Modelo DOM del documento/estructura (usado por reflujo, accesibilidad, texto) | [VER] + (inferido por el nombre) |
| `reflow.api` | 0,4 | Vista de reflujo | [VER] |
| `Spelling.api` | 0,4 | Corrector ortográfico (diccionarios en `Common Files\Adobe\Acrobat\DC\Linguistics`) | [VER] |
| `weblink.api` | 0,4 | Enlaces web / captura web | [VER] |
| `ReadOutLoud.api` | 0,3 | Leer en voz alta | [VER] |
| `DropboxStorage.api` | 0,3 | Conector de Dropbox | [VER] |
| `IA32.api` | 0,3 | Acceso a Internet desde el núcleo | [VER] |
| `Updater.api` | 0,2 | Actualizador integrado (colabora con ARM) | [VER] |
| `DVA.api` | 0,2 | Sin documentación pública localizada; los metadatos lo relacionan con `acroML` ("DVA Product") | [VER] |
| `eBook.api` | 0,06 | DRM de Adobe para eBooks | [VER] |

Observaciones:

1. **No hay `.api` para** Optimizador, Redacción, Preflight, Comparar, OCR/Escanear ni exportación/conversión, pero `Locale\es_ES` conserva recursos `.ESP` con esos nombres (`Compare`, `HTML2PDF`, `ImageConversion`, `Scan`, `AcroScanBroker`, `WebPDF`, `saveasxml`...). **(inferido por el nombre)** esas funciones existen como módulos que hoy viven **dentro de `Acrobat.dll`**, en la **capa web/nube**, o son componentes opcionales. Lección: Adobe mantiene "núcleo + plug-ins" pero ha ido **plegando funciones al núcleo** y moviendo interfaz y servicios a la capa web.
2. Los **recursos de cada módulo van aparte** (un `.ESP` por plug-in), con un idioma por carpeta.
3. El SDK menciona la carpeta `plug_ins/spi_brokers` para brokers [SDK]; aquí se llama `pi_brokers` (cambio de nombre entre versiones, o doc desfasada).

### 3.5 Otros módulos del ecosistema de plug-ins (por nombres)

- `plug_ins\AcroForm\PMP`: `AdobePDF417`, `DataMatrix`, `QRCode` → símbolos de código de barras para campos de formulario (inferido por el nombre).
- `plug_ins\Annotations\Stamps`: bibliotecas de **sellos como archivos PDF** (`Dynamic`, `Faces`, `Pointers`, `SignHere`, `Standard`, `StandardBusiness`, más `Words` y `CompareMarkers`) en carpetas por idioma. `CompareMarkers.pdf` sugiere que **Comparar** pinta sus marcas con sellos PDF (inferido por el nombre).
- `plug_ins\Multimedia\MPP`: reproductores (`Mcimpp`, `WindowsMedia`).
- `plug_ins3d`: `2d`, `3difr`, `drvDX9/DX11/SOFT`, `prcr` (formato PRC), `tesselate`.

### 3.6 Runtime web (CEF / WebView2) y capa de interfaz

- **Sí incluye runtime web:** `AcroCEF\` (Chromium: `libcef.dll` 168 MB, `chrome_elf.dll`, GL/Vulkan/SwiftShader, `.pak`, snapshots de V8) y `WebViewInstaller.exe` + `webview2.tlb` (Edge WebView2).
- `WebResources\Resource2` es una aplicación web de una página (`index.html` + puentes JS con nombres como `acro_js`, `plugins`, `init`, `variant`, `version`; inferido por el nombre) con **componentes versionados por carpeta**: `dc-avalon-component` (4.36.0_1.39.0), `dc-jot-component` (4.36.0_1.236.0), `dc-transform-component` (4.36.0_2.129.0), `dc-desktop-app-dropin` (1.0.0_1.0.0), `fonts`, `mathjax` (nombres de carpeta). Patrón: **micro-frontends con versión semántica propia**, desplegables por separado, junto a un actualizador específico (`SingleClientServicesUpdater`; inferido).
- `WebResources\SA` contiene un `dc-desktop-app-dropin` y recursos estáticos (nombres): segunda "aplicación" web ligera.
- Contenido: 2.362 `.js`, 2.828 `.png`, 860 `.svg`, 273 `.webm`, 81 `.css`, 48 `.otf` + 23 `.woff` (recuentos).
- La **licencia (NGL)** tiene además su propio CEF y su `index.html` (inferido por el nombre).
- Temas: `UIThemes\DarkTheme/LightTheme.acrotheme`.
- Adobe confirma que `AcroCEF`/`RdrCEF` atienden **red y servicios de Document Cloud** (Fill & Sign, revisión compartida) y que son inseparables de la aplicación [AYUDA].

### 3.7 Conversión, OCR y aprendizaje automático (por nombres)

- **Conversión/creación:** `AdobePDFL.dll` (10 MB, "Adobe PDF Library" 18.0.8.1 [VER]; es un SDK comercial documentado públicamente en [SDK]; que Acrobat lo use internamente es **inferido por el nombre**), `SaveAsRTF.api`, recursos `HTML2PDF/ImageConversion/WebPDF/saveasxml` (inferido), códecs `AIDE`/`JP2KLib`.
- **OCR:** **no hay ningún módulo con nombre OCR** en esta instalación; existen recursos `Scan.ESP` y `AcroScanBroker.ESP` (inferido por el nombre). Probablemente integrado en `Acrobat.dll`/`AdobePDFL` o en la nube.
- **ML local:** `RdrTools\acroML.dll` (22,9 MB), `onnxruntime.dll` (15,7 MB), `onnxruntime-genai.dll`, `PipelineLib_DT.dll` y carpeta `models` con 8 subcarpetas numeradas (los archivos mayores pesan 18 y 13 MB) → **inferencia de modelos en el equipo** (inferido por el nombre). Los recursos de marketing (`AIChat`, `GenAI`, `PdfSpaces` en `Assets`) apuntan a funciones de IA, pero **no se puede saber qué parte corre local y cuál en la nube**.
- **Texto/idioma:** `AdobeLinguistic.dll`, carpeta `Linguistics`, `stopwords.*`, `Onix.dll`.

### 3.8 Recursos: fuentes, plantillas, ajustes

- **Fuentes:** en la instalación solo se ven `AdobeClean-*.otf` (interfaz del informe de fallos), `MyriadCAD.otf` (3D) y 48 `.otf` + 23 `.woff` dentro de `WebResources`. No hay carpeta de fuentes de sustitución visible; la tipografía de documentos la gestiona `CoolType.dll` con las fuentes del sistema (inferido).
- **Plantillas PDF:** `DocTemplates` (3 por idioma), `IDTemplates` (`AdobeID`, `DefaultID`), `HostedServicesTemplates`, sellos, PDF de tutorial.
- **Ajustes declarativos (`DocSettings`):** archivos XML por región para **patrones de búsqueda de redacción** y **juegos de códigos** (`SearchRedactPatterns.xml`, `U.S. FOIA.xml`, `U.S. Privacy Act.xml` en `ENU`; solo patrones en `UK`...). La guía de administración confirma que los ajustes guardados de encabezados/pies/marcas de agua/fondos son **archivos XML en `DocSettings`** que se pueden desplegar [ADMIN].
- **Acciones:** `Sequences\*.sequ` (cadenas de pasos tipo *Action Wizard*, inferido por el nombre).

### 3.9 Seguridad, actualización y telemetría

- **Aislamiento:** brokers (`AcroBroker`, `pi_brokers`), y, según la documentación pública, el *Modo protegido* (sandbox + broker) para parseo, JavaScript y 3D (§4.3).
- **Actualización:** servicio ARM + tarea programada + `Updater.api` + actualizador de servicios web (cuatro mecanismos distintos, inferido en parte por el nombre).
- **Fallos y telemetría:** cuatro ejecutables de crash reporting, `CRClient.dll`, `logsession.dll`, `AdobeGrowthSDK.dll`, `mip_ClientTelemetry.dll` ("Microsoft Applications Telemetry SDK" [VER]) y una carpeta `appmeasurement` en `WebResources` (inferido por el nombre).
- **Integración con Windows:** vista previa/miniaturas (`PDFPrevHndlr`, `adobeafp`), ActiveX `AcroPDF`, menú contextual moderno (`ContextMenuIExplorerCommandShim.dll` + `ReaderMenuCoreApp.msix`), extensión de Chrome con *host* de mensajería nativa.

### 3.10 Diagrama

```
 Acrobat.exe (6,6 MB, lanzador) --> Acrobat.dll (87,7 MB, nucleo) + AcrobatRes.dll (32 MB)
     |                                  |
     |                                  +-- librerias compartidas Adobe: AGM, CoolType, ACE, AIDE, JP2KLib, XMP...
     |                                  +-- plug_ins\*.api (25) <-- tablas de funciones (HFT) [SDK]
     |                                  |       +-- plug_ins\pi_brokers\*.exe  (operaciones con privilegios)
     |                                  +-- motor JS: EScript.api + ScCore/ExtendScript + Javascripts\*.bin
     |                                  +-- RdrTools: AdobePDFL, acroML + ONNX Runtime + models (inferido)
     |
     +-- AcroCEF.exe (Chromium, multiproceso) --> WebResources (app web, 414 MB, componentes dc-* versionados)
     +-- WebView2 (instalador incluido)
 Satelites: AdobeCollabSync (residente) | acrobat_sl (arranque rapido) | ARM (servicio+tarea) | crash reporter (x4)
            licencias NGL (CEF propio) | shell: AcroPDF, vista previa, menu contextual W11, extension Chrome
```

### 3.11 Conclusiones arquitectónicas

1. **Núcleo + plug-ins + HFT** se mantiene 25 años después; las funciones nuevas tienden a ir al núcleo o a la capa web.
2. **Interfaz web híbrida**: el 53 % del tamaño es Chromium + recursos web. SnowPDF ya hace lo mismo con Tauri/WebView2 **sin empaquetar un Chromium** (Adobe gasta ≈643 MB en ello); es una ventaja a conservar.
3. **Separación de privilegios** por procesos intermediarios (brokers) y por proceso auxiliar de interfaz (CEF).
4. **Todo lo configurable es declarativo y externo al binario**: patrones, códigos, plantillas, secuencias, temas, sellos como PDF, ajustes en XML por región.
5. **Cada módulo trae sus recursos localizados** y su versión; la capa web versiona por componente.
6. **Varias vías de actualización** (servicio ARM, tarea programada, plug-in actualizador, actualizador de servicios web) y **varias de telemetría/fallos** (cuatro ejecutables de crash reporting, SDK de "growth", telemetría de MIP): lo que SnowPDF *no* debe copiar si quiere mantener su promesa de "100 % local, sin red".

---

## 4. Arquitectura en capas (SDK público) y mapeo a SnowPDF

### 4.1 Las capas [SDK]

| Capa | Qué es | Objetos / ideas clave |
|---|---|---|
| **Cos** | Acceso de bajo nivel a los bloques del PDF | Tipos: booleano, entero, real, nombre, cadena, array, diccionario, flujo (stream). Los métodos usan el verbo `Put` (no `Set`) |
| **PD** (Portable Document) | Modelo de documento: páginas, anotaciones, fuentes, marcadores | `PDDoc`, `PDPage`, `PDAnnot`, `PDFont`, `PDBookmark` |
| **PDFEdit** | Contenido **físico** de la página como lista modificable de objetos (texto, imágenes, trazados) + fuentes y recursos | Edición del contenido de página |
| **PDSEdit** | Estructura **lógica** (árbol de estructura) independiente del orden de dibujo | Accesibilidad, reflujo, etiquetado |
| **AV** (Acrobat Viewer) | Controlar la aplicación y su interfaz: menús, botones de barras, abrir/cerrar, diálogos | `AVDoc`, `AVWindow`, `AVPageView`, `AVMenu`. **No existe en PDF Library**: es solo de la aplicación |
| **AS** (Acrobat Support) | Utilidades: memoria independiente de plataforma, matemáticas de punto fijo, y un **sistema de ficheros reemplazable** (permite almacenar en la nube o en otros sistemas) | `ASFile...` |
| Plataforma | Utilidades específicas de Windows/Mac | |

Convenciones de la API (útiles como guía de estilo): objetos **opacos** (asignar uno a otra variable comparte el mismo objeto interno), nombres `<capa><objeto><verbo><cosa>`, pares **Acquire/Release** con cuenta de referencias (un par desbalanceado puede impedir que un documento se cierre), sufijos `Rec`/`P`/`Proc` para estructuras, punteros y *callbacks* [SDK].

### 4.2 Modelo de plug-ins [SDK]

- **Descubrimiento:** carpeta de plug-ins junto al ejecutable y un nivel de subcarpetas; mantener *Mayús* al arrancar evita cargarlos; en *modo certificado* no se cargan los de terceros.
- **Handshake** (`PIHandshake`) y tres fases de arranque, siempre en este orden: `PluginExportHFTs` → `PluginImportReplaceAndRegister` → `PluginInit` (la única obligatoria). La UI de Acrobat solo termina de arrancar **cuando todos han cargado**. Hay `PluginUnload` al salir.
- **HFT (Host Function Table):** tabla de punteros a función con **nombre y versión**; cada entrada es una **lista enlazada** para que un plug-in pueda **reemplazar** un método y aun así llamar a la implementación anterior (reemplazables, p. ej., `AVAlert`, `AVDocClose`, `PDDocSave`). Un **servidor de HFT** atiende peticiones y puede servir varias versiones; las versiones difieren normalmente en cuántos métodos hay, no en su orden. Se importan por nombre y versión durante la inicialización.
- **Notificaciones:** se registran en la fase de importación; pueden llegar antes de `PluginInit`. Para trabajo posterior al arranque hay una notificación de "aplicación inicializada".
- **Reglas de inicialización:** no abrir diálogos (puede haber arrancado por automatización), no invocar JS ni cargar librerías ni tocar disco; crear los elementos de menú en `PluginInit`.
- **Manejadores (handlers):** acciones, anotaciones, **comandos (AVCommand)** ejecutables de forma interactiva, programática o por lotes, conversiones de formato (solo Acrobat, no Reader), especificaciones de archivo, **servidores de selección**, **herramientas**, ventanas, sistemas de archivos, monitores de progreso, transiciones. Patrón común: rellenar una estructura de *callbacks* y registrarla con una función `AVAppRegister...`.
- **Enrutado de entrada:** los clics van primero a los manejadores de clic de la vista de página, luego a la **herramienta activa**, luego a las anotaciones; el teclado va primero al **servidor de selección activo** y después a teclas especiales/barra de herramientas.
- **Prefijos registrados** (p. ej. `ADBE`) para evitar colisiones: nombres de plug-in, menús, herramientas, acciones, tipos de anotación, HFT y **datos privados dentro del PDF** (nombres de segunda clase `Prefijo_Nombre`).
- **Plug-ins de Reader:** requieren "habilitación" con pares de claves; hay además un modo reducido (sin plug-ins de terceros) cuando el instalador unificado actúa como Reader [SDK][ADMIN].

### 4.3 Sandbox y brokers [SDK][ADMIN]

- El **Modo protegido** ejecuta en un proceso restringido el parseo de PDF/imágenes, el JavaScript y el renderizado 3D; todo lo que cruza el límite pasa por un **proceso broker** de confianza que aplica **listas blancas** de política (reglas tipo `FILES_ALLOW_READONLY`, `REG_ALLOW_ANY`, `PROCESS_ALL_EXEC`...).
- Por defecto el proceso restringido **solo lee los datos de la propia aplicación y los PDF que el usuario abrió explícitamente**; para lo demás el broker **pregunta al usuario**, y registra las violaciones de política sugiriendo la regla que las habría permitido.
- **Vista protegida:** modo de solo lectura hasta que el usuario "confía" en el documento; configurable como *nunca / ubicaciones no confiables / siempre*; depende del modo protegido. **AppContainer** es una capa adicional. Cada PDF abierto tiene su **propio par de procesos**.
- Los plug-ins con necesidades privilegiadas usan un **plugin broker** propio, lanzado por el broker desde una carpeta incluida en la lista blanca, comunicado por un canal IPC con llamadas cruzadas definidas por ID y con firma de código [SDK].
- Lecciones de diseño de Adobe: mínimo privilegio con mediación, defensa en capas (vista protegida + modo protegido + AppContainer), excepciones de política acotadas en vez de desactivar la protección, diagnóstico por registro y **sin trato especial a documentos "certificados"**.

### 4.4 Mapeo a SnowPDF

| Adobe | Equivalente actual en SnowPDF | Hueco / siguiente paso |
|---|---|---|
| **Cos** | `@cantoo/pdf-lib` (`PDFDict`, `PDFArray`, `PDFStream`) y `mupdf` `PDFObject` (`get/put/delete/readStream/writeStream`) bajo `src/pdf/` | Una fachada única "raw" para no mezclar APIs en cada herramienta |
| **PD** | `src/model/` (`SourceInfo`, `PageRef`, `EditorObject`, `DocState`) + `src/pdf/docUtils.ts` | Anotaciones reales (`/Redact`, comentarios), marcadores, capas y adjuntos como ciudadanos del modelo |
| **PDFEdit** | `src/pdf/bake.ts`/`compose.ts` (dibujar objetos con pdf-lib) + redacción MuPDF para quitar contenido | Falta un **modelo de contenido de página** (bloques de texto, imágenes) para editar texto por párrafos |
| **PDSEdit** | *(ausente)* | Árbol de estructura/etiquetado: base de accesibilidad y PDF/UA (largo plazo) |
| **AV** | React: `src/features/editor`, `src/ui`, `src/features/organize` | Enrutado de entrada explícito (vista → herramienta activa → objetos), como en AV |
| **AS** | `src/platform` (Tauri vs navegador) | Ya es el equivalente del "sistema de ficheros reemplazable" de AS |
| **Plug-ins + HFT** | `src/features/tools/registry.ts` (registro estático de herramientas) | Contrato de módulo con ciclo de vida, servicios requeridos y eventos (§6, idea 13) |
| **Handlers (acción, anotación, herramienta, selección)** | Tipos de `EditorObject` + herramientas del editor | Registrar un *handler* por tipo de objeto (dibujar, hit-test, editar, serializar a PDF) en lugar de `switch` |
| **AVCommand** (interactivo, programático o por lotes) | `BatchToolDef` (herramientas por lotes) | Unificar como `Command` ejecutable sin UI → habilita secuencias y tests |
| **Notificaciones** | *(ausente)* | Bus de eventos: documento abierto, antes/después de guardar |
| **Modo protegido + broker** | MuPDF WASM en Web Worker (sin red ni disco) + permisos de Tauri | Modo lectura para archivos no confiables, un worker por documento, scripts PDF desactivados |
| **DocSettings (XML)** | *(ausente)* | Almacén de presets JSON (§6, idea 4) |

Nota: las rutas de `src/pdf/` y `src/features/` salen de `docs/ARCHITECTURE.md`; en el momento del análisis el árbol real todavía estaba creciendo (otros agentes trabajan en el proyecto), así que algunos archivos citados (`compose.ts`, `bake.ts`, `src/pdf/mupdf/`...) pueden no existir aún.

### 4.5 Lecciones de diseño aplicables

1. **Arranque en fases** y "sin trabajo pesado en init": SnowPDF puede registrar herramientas de forma perezosa (carga dinámica) y no abrir el worker de MuPDF hasta el primer uso.
2. **Un manejador por tipo de objeto** (anotación, herramienta, selección) evita condicionales gigantes en el editor.
3. **Enrutar la entrada con prioridades fijas** (vista → herramienta activa → objetos; teclado → selección → atajos globales).
4. **Reemplazo encadenado** (HFT): un "middleware" de guardado permite que *sanitizar al guardar*, *aplanar al guardar* o *quitar metadatos* se enchufen sin tocar `compose.ts`.
5. **Cuenta de referencias explícita** (`Acquire/Release`): en WASM los objetos de MuPDF no se liberan solos; usar envoltorios con `try/finally` (o `using`) para evitar fugas y bloqueos al cerrar documentos.
6. **Prefijo propio para datos privados** dentro del PDF (nombres de segunda clase tipo `/SNOW_...`) si algún día se guardan ediciones reabribles en el archivo.
7. **Configuración declarativa** (patrones, códigos, sellos, secuencias) en archivos editables, con valores por región.

---

## 5. Comportamientos y opciones emulables

Los **comportamientos y opciones** no son material protegido; aquí se describen con palabras propias y con su evidencia.

### 5.1 Optimizar y reducir tamaño

**Tres vías en Acrobat**

1. **Reducir tamaño de archivo** (Guardar como otro → PDF de tamaño reducido): vuelve a muestrear y recomprimir imágenes, **quita las fuentes Base-14 incrustadas**, hace *subset* de las demás fuentes incrustadas, comprime la estructura y limpia marcadores no válidos. Tiene selector **"Compatible con"** (versión mínima de Acrobat) y **"Aplicar a varios"**. No hace nada si el archivo ya está al mínimo y **elimina las firmas digitales** [AYUDA].
2. **PDF optimizado** (Optimizador avanzado): paneles **Imágenes, Fuentes, Transparencia, Descartar objetos, Descartar datos de usuario, Limpieza**, cada uno activable con casilla; presets guardables (el predeterminado se llama *Standard* y pasa a *Custom* si cambias la compatibilidad); botón **Auditar uso del espacio**; proceso por lotes; algunas opciones dependen de la versión de compatibilidad elegida (una guía de la comunidad indica que JBIG2 y JPEG2000 se habilitan con compatibilidad Acrobat 6; el SDK exige PDF ≥ 1.5 para JPEG2000 y para la compresión de objetos) [AYUDA][COM][SDK].
3. **Compresión simple en la web**: tres niveles **Alto / Medio / Bajo** (Alto = archivo más pequeño), con **estimación del tamaño antes de aplicar** y salida con sufijo `_compressed`; la API de servicios documenta un parámetro de nivel de compresión (en sus ejemplos aparecen al menos LOW y MEDIUM) [AYUDA][COM].

**Imágenes (color, gris y monocromo por separado) [SDK]**

- Métodos: **Promedio**, **Bicúbico** (el más lento y de transiciones más suaves; el menos propenso a perder imágenes monocromas), **Submuestreo** (el más rápido, de peor calidad) y **Ninguno**.
- **Regla del umbral:** solo se reduce si `ppi_origen / ppi_destino > umbral`. Umbral por defecto **1,5** (rango 1,0-10,0; fuera de rango vuelve a 1,5). Ejemplo: destino 150 ppi → solo se reducen imágenes de **más de 225 ppi**; monocromo con destino 300 → más de **450 ppi** (la interfaz muestra 225 y 450).
- **Valores por defecto documentados** de los "Adobe PDF settings": color y gris → bicúbico a **150 ppi**; mono → bicúbico a **300 ppi**; filtro JPEG por defecto (autofiltro JPEG; JPEG2000 solo con PDF ≥ 1.5); mono → **CCITT grupo 4** (alternativas ZIP/RunLength); JPEG con `QFactor 0,76` y submuestreo de croma `[2 1 1 2]`; JPEG2000 con teselas 256×256 y calidad 15; recorte de imágenes a su zona visible activado (confirmado para gris y mono en el extracto leído); compatibilidad por defecto PDF 1.4; compresión de páginas activada; "optimizar para vista rápida" activado; compresión de objetos desactivada.
- **Tabla de calidad JPEG** [SDK]:

| Calidad | QFactor | Submuestreo de croma |
|---|---:|---|
| Mínima | 2,40 | `[2 1 1 2]` |
| Baja | 1,30 | `[2 1 1 2]` |
| Media | 0,76 | `[2 1 1 2]` |
| Alta | 0,40 | `[1 1 1 1]` |
| Máxima | 0,15 | `[1 1 1 1]` |

  Regla: `QFactor ≥ 0,5` → croma submuestreado; `< 0,5` → sin submuestreo.
- Consejos de las guías [COM]: no bajar de ~144 ppi en color/gris salvo necesidad (72 ppi solo como último recurso), no bajar de 300 ppi en monocromo (o usar JBIG2 con pérdida), JPEG2000 para fotos y JBIG2 para escaneos B/N cuando la compatibilidad lo permita.

**Fuentes:** lista de fuentes del documento; **desincrustar** las comunes; hacer *subset* (el valor por defecto de "porcentaje máximo de subset" es 100). Advertencia: el texto con fuentes no incrustadas o con *subset* **no se puede editar** después [COM][SDK].

**Transparencia:** aplanado con ajustes de resolución para texto/líneas/degradados; pensado para imprenta; inactivo por defecto [COM].

**Descartar objetos** (lista parcial confirmada): aplanar campos de formulario (*destruye formularios*), acciones JavaScript, imágenes alternativas, miniaturas de página incrustadas, **etiquetas del documento** (pierde accesibilidad y reflujo), marcadores, índice de búsqueda incrustado [AYUDA][COM].

**Descartar datos de usuario:** comentarios, formularios y multimedia; información de documento y metadatos (las guías recomiendan conservar al menos *Título* y *Autor*); archivos adjuntos; datos privados de otras aplicaciones; capas ocultas; referencias cruzadas externas [AYUDA][COM]. Las listas de estos dos paneles **muestran solo lo que el examen del documento ha encontrado**.

**Limpieza:** "comprimir el archivo completo" (compresión de objetos y de estructura), codificar con Flate lo no codificado, quitar **marcadores y enlaces no válidos**, **optimizar para vista rápida en web** (recomendado salvo en formularios con mucho JavaScript) [AYUDA][COM].

**Auditoría de espacio:** informe de bytes y porcentaje por elemento. Categorías vistas en las fuentes: imágenes, fuentes, flujos de contenido, *document overhead*, espacios de color, estados gráficos extendidos, marcadores, formularios, destinos con nombre, comentarios [AYUDA][COM]. Se recomienda repetirla tras optimizar.

### 5.2 Redactar y sanear

**Marcar**

- **Marcar para redactar** sobre texto, imágenes o un área: aparece un **contorno rojo**; al pasar el cursor se previsualiza el **parche negro**; se puede dibujar un rectángulo para zonas grandes [QS].
- **Marcar páginas** (la actual o un rango) [QS].
- **Buscar y eliminar texto**: ámbito = documento actual o **carpeta de archivos**; palabra o frase única, **varias palabras/frases**, o **patrones** (tarjeta de crédito, teléfono...); lista de resultados con casillas → *Marcar resultados seleccionados* [QS]. La ayuda indica que la búsqueda no funciona en PDF cifrados [AYUDA] (no verificado).
- **Propiedades** de las marcas: color de relleno, **texto superpuesto** (con opción de repetirlo), opacidad; doble clic en una marca abre una nota explicativa [QS][AYUDA]. **Códigos de redacción** = texto superpuesto con entradas predefinidas organizadas en *juegos de códigos*; Acrobat trae juegos para *U.S. FOIA* y *U.S. Privacy Act* y se pueden crear propios [AYUDA].

**Patrones (comportamiento)**

- Incluidos de serie: número de la seguridad social de EE. UU., correo electrónico, teléfono, fecha y tarjeta de crédito [blog de Adobe].
- Se definen como **expresiones regulares** en un archivo XML por **configuración regional**, con *nombre visible*, *expresión* y *descripción opcional*; el usuario puede añadir los suyos y aparecen en el diálogo de búsqueda tras reiniciar [blog de Adobe]. En esta instalación hay juegos regionales `CAN, DEU, ENU, FRA, JPN, UK` (nombres de carpeta).

**Aplicar**

- Las marcas **no eliminan nada** hasta *Aplicar redacciones* **y guardar**. Al aplicar, Acrobat pide confirmar que es **permanente** y **ofrece eliminar información oculta** (sanitizado). Guarda por defecto con el sufijo **`_Redacted`** para no perder el original [QS].
- En la interfaz nueva: *Redactar → Aplicar → Continuar* (quita comentarios, metadatos y capas ocultas, entre otros) y guarda en un archivo nuevo; el *Action Wizard* puede automatizar el proceso [AYUDA].

**Sanear (dos modos)**

- **"Sanitize Document" en un paso:** busca y elimina datos ocultos (texto, metadatos, anotaciones, campos de formulario, adjuntos y marcadores) tras un aviso, y pide guardar con otro nombre [QS][COM].
- **Quitar información oculta / "Selectivamente":** lista de comprobación con **todas las casillas marcadas por defecto** y entradas expandibles con vista previa: **metadatos** (propiedades y XMP), **adjuntos**, **marcadores**, **comentarios y marcas**, **campos de formulario** (y firmas), **índice de búsqueda incrustado**, **texto oculto**, **capas ocultas**, **vínculos, acciones y JavaScript** (solo se avisa), **objetos superpuestos**, **contenido eliminado o recortado** [COM][AYUDA].
- Nota de usuarios: el sanitizado de un paso no siempre elimina imágenes recortadas; el modo selectivo sí [COM, no oficial].

### 5.3 Editar PDF (texto e imágenes)

Comportamiento descrito en la ayuda pública [AYUDA]:

- El texto se edita en **cuadros por párrafo**: al editar, el párrafo se **reajusta (reflujo) dentro de su cuadro**.
- **Cada cuadro es independiente**: insertar texto en uno no empuja a los vecinos ni salta a la página siguiente. **Solo se edita dentro de la página**; no se mueven caracteres o palabras sueltos dentro de un cuadro.
- **Redimensionar** un cuadro vuelve a envolver el texto **sin cambiar el tamaño de fuente**.
- Al **añadir texto**, Acrobat toma atributos de fuente de lo que hay cerca.
- **Fuentes:** para editar, la fuente debe estar **instalada o incrustada**; si no está disponible se **sustituye por una fuente de reserva** según la escritura; existe un ajuste de *fuente predeterminada*. Un PDF con fuentes no disponibles suele dar error de edición ("no hay fuente de sistema disponible"); la ayuda sugiere instalar la fuente [AYUDA] y la comunidad menciona el arreglo de Preflight "incrustar fuentes que faltan" [COM].
- Existe un ajuste **"Autoajustar diseño"** que se puede desactivar para la herramienta (según la comunidad) [COM].
- Un **escaneo** debe pasar antes por reconocimiento de texto para poder editarse [AYUDA].
- Imágenes: añadir, reemplazar, recortar, redimensionar, rotar y ordenar [AYUDA].

### 5.4 Rellenar y firmar

- Los **campos de formulario se detectan automáticamente** (texto, campos con peine, casillas, botones de opción); al pasar el cursor se resalta con una **caja azul** [AYUDA].
- En **formularios planos** (sin campos) se puede escribir **en cualquier lugar** y colocar símbolos y texto como nombre, empresa, cargo o **fecha** [AYUDA]. La lista exacta de símbolos de escritorio no se verificó (la ayuda móvil cita marca de verificación, cruz y botón de opción; SnowPDF ya tiene ✓ ✗ ○ •).
- **Firma e iniciales:** crear (escribir, dibujar o imagen), guardar y arrastrar; color **negro por defecto**; mover y redimensionar [AYUDA].
- Parte del servicio (enviar para firmar, revisión compartida) pasa por la **capa web/nube**, que SnowPDF no replica.
- En "Preparar formulario" existe la **detección automática de campos** (convierte líneas, casillas y símbolos en campos) que a veces falla y se puede desactivar [COM].

### 5.5 Proteger

- Dos contraseñas: **de apertura** y **de permisos**; deben ser **distintas** [AYUDA].
- **Compatibilidad → cifrado:** Acrobat 6 (PDF 1.5) = RC4 128 bits; Acrobat 7 (PDF 1.6) = AES 128 bits; Acrobat X y posteriores (PDF 1.7) = **AES 256 bits**; un lector antiguo no abre archivos con cifrado más nuevo [AYUDA].
- **Qué se cifra:** *todo el contenido* (incluidos los metadatos: los buscadores no los ven), *todo excepto los metadatos* (los buscadores sí) y, en algunas versiones, *solo los adjuntos* (esta última opción es de memoria del autor, no verificada en esta sesión) [AYUDA].
- **Permisos** [AYUDA]:
  - *Impresión permitida:* ninguna / **baja resolución (150 ppi)** (requiere compatibilidad ≥ PDF 1.4; imprime como mapa de bits) / alta resolución.
  - *Cambios permitidos:* ninguno / **insertar, eliminar y girar páginas** (solo cifrado alto) / **rellenar campos y firmar** / **comentar, rellenar campos y firmar** / cualquiera excepto extraer páginas.
  - *Copiar texto, imágenes y otro contenido.*
  - *Acceso al texto para lectores de pantalla* (solo cifrado alto).
- **Correspondencia con la especificación PDF (ISO 32000-1, tabla de permisos; no es contenido de Adobe):** bit 3 imprimir; bit 4 modificar contenido; bit 5 copiar/extraer; bit 6 anotar y rellenar formularios; bit 9 rellenar campos existentes (aunque falte el 6); bit 10 extracción para accesibilidad; bit 11 ensamblar (insertar/girar/eliminar páginas, marcadores, miniaturas); bit 12 impresión de alta calidad. "Baja resolución" = bit 3 activo y bit 12 inactivo.
- La documentación pública de los servicios de PDF de Adobe lista cifrado AES-128 y AES-256, contraseña de usuario (abrir) y de propietario (permisos), y permisos como imprimir en baja calidad, ensamblar el documento y copiar contenido (en sus ejemplos), además de describir impresión en alta calidad y restricción de rellenar-y-firmar campos; remite a la referencia de la API para la lista completa [COM/documentación de API].

### 5.6 Organizar páginas, encabezados, Bates y marcas de agua

- **Extraer:** páginas sueltas o rango; filtros por **orientación** o **pares/impares**; opciones **"eliminar páginas tras extraer"** y **"extraer cada página como archivo"** [AYUDA][COM].
- **Insertar** desde archivo, portapapeles, escáner, página web o **página en blanco**; **reemplazar** páginas desde otro documento; **eliminar**; **girar** con el icono al pasar el cursor o en selección múltiple [AYUDA].
- **Dividir** por **número de páginas**, **tamaño máximo de archivo** o **marcadores de primer nivel** [AYUDA].
- **Encabezados y pies:** se pueden guardar y reutilizar [AYUDA]; los ajustes guardados son XML en `DocSettings` [ADMIN].
- **Numeración Bates:** lote por archivos/carpetas/abiertos, orden configurable, opciones **número de dígitos (3-15, por defecto 6)**, **número inicial**, **prefijo** y **sufijo**; Adobe recomienda **no usar `#`** en prefijo/sufijo; no admite PDF cifrados y convierte antes los archivos no PDF [AYUDA].
- **Marcas de agua y fondos:** ajustes guardables con lista de ajustes; mismo almacenamiento XML [ADMIN].

### 5.7 Comparar archivos

[AYUDA]

- Se eligen el documento **antiguo** y el **nuevo** (abiertos o desde disco) y se puede **limitar a un rango de páginas** en cada uno.
- **Tipo de documento:** autodetectar, **informes/hojas de cálculo/maquetaciones de revista**, **presentaciones** o **documentos escaneados/dibujos**; casilla **"comparar solo texto"** para ignorar diferencias gráficas.
- Para **escaneos** Acrobat crea una **captura de imagen** de cada página y **compara píxeles**.
- Resultado en un **documento nuevo**: vista **lado a lado** o de una página, barra de resaltado y **resumen de cambios** (añadido, eliminado, modificado) con **filtros por tipo**: texto, imágenes, anotaciones y formato. Se puede **compartir como informe PDF**.
- En el pack de sellos existe `CompareMarkers.pdf` (inferido por el nombre: marcas de cambio como sellos PDF).

### 5.8 OCR (Reconocer texto)

- **Idioma principal de OCR.**
- **Estilos de salida:** **Imagen con texto buscable** (reconoce y **remuestrea la imagen**; usa el ajuste *Reducir resolución a*), **Imagen con texto buscable (exacta)** (capa de texto **invisible** sobre la **imagen intacta**: máxima fidelidad, archivo mayor) y **Texto e imágenes editables** (rehace la página con texto editable; "ClearScan" sustituye las letras por fuentes: **no conserva el escaneo original**) [COM]. La API de servicios documenta solo `SEARCHABLE_IMAGE` (limpia, p. ej. endereza, y añade capa de texto) y `SEARCHABLE_IMAGE_EXACT` [COM/documentación de API].
- Si el PDF ya tiene OCR, Acrobat **no hace nada** o ofrece **"Volver a reconocer"**; se puede **corregir texto reconocido** palabra a palabra y **revisar el texto reconocido** [COM].
- **Escanear y OCR:** mejora previa (**enderezar y limpiar la imagen**, arrastrar los bordes de la página; en la versión web también quitar el fondo) y luego "Reconocer texto"; el **lote** se hace con Action Wizard [AYUDA].

### 5.9 Preflight y estándares (PDF/A, PDF/X, PDF/E)

- Los criterios se guardan como **perfiles**; un perfil contiene **comprobaciones**, **correcciones (fixups)** o ambos (icono de llave inglesa si corrige). Grupos: impresión digital, análisis de PDF, preimpresión, cumplimiento de **PDF/A, PDF/E y PDF/X** [AYUDA].
- Flujo: *Preflight → biblioteca "Estándares PDF" → perfil (p. ej. "Convertir a PDF/A-1b") → Analizar y corregir → guardar*. **Verificar** = ejecutar el perfil de cumplimiento y leer la pestaña de resultados (marca verde = cumple, aspa roja = no cumple) [AYUDA].
- Hay un atajo "Guardar como PDF/A, PDF/X o PDF/E" [AYUDA].

### 5.10 Automatizar (Action Wizard)

- Cadenas de pasos con nombre (en esta instalación: `Sequences\Action01-06`), ejecutables sobre muchos archivos; usadas para **lotes de OCR**, **redactar + sanear**, etc. [AYUDA]. Los ajustes de varias herramientas (patrones, encabezados, marcas de agua) se guardan como archivos declarativos [ADMIN].

---

## 6. Ideas priorizadas para SnowPDF (máximo 15)

Escala de esfuerzo: **S** ≤ 1 día · **M** 2-4 días · **L** más de 4 días. Orden = impacto/coste, con prioridad a lo que refuerza la promesa "100 % local y privado" y a lo que cierra la hoja de ruta v0.2/v0.3. Las rutas marcadas *(nuevo)* no existen aún; el árbol real de `src/` está todavía creciendo (otros agentes), así que conviene ajustar los nombres de carpeta al crear los archivos. Cada idea debería llevar su prueba en `tests/` (vitest en Node), sobre todo la parte pura.

| # | Idea | Módulo(s) de SnowPDF | Qué implementar | Esf. | Base en Acrobat |
|---:|---|---|---|:--:|---|
| 1 | **Sanitizar / "Quitar información oculta"** | `src/pdf/mupdf/` (operación nueva en el worker), `src/pdf/tools/sanitize.ts` *(nuevo)*, página en `src/features/tools`, aviso tras aplicar redacciones en `src/features/editor` | Dos modos: *1 clic* y *selectivo* (casillas marcadas por defecto con recuento y vista previa). Elementos: metadatos (Info + XMP), adjuntos (`getEmbeddedFiles`/`deleteEmbeddedFile`, anotaciones `FileAttachment`), JavaScript y acciones (`/OpenAction`, `/AA`, `Names/JavaScript`, widgets), comentarios/anotaciones, marcadores, enlaces, campos de formulario (`bake`), miniaturas, **capas ocultas** (`countLayers`/`isLayerVisible`; mupdf.js no trae "quitar contenido OC": hará falta un filtro propio de `BDC /OC … EMC` y de XObjects/anotaciones ocultos), **contenido fuera del recorte** (anotaciones `Redact` sobre las bandas externas + `applyRedactions` sin cajas negras). Detectar y **avisar** (sin borrar) texto oculto y objetos superpuestos: el texto invisible (modo 3) también es la capa del OCR. Guardar **sin actualización incremental** y con `garbage=deduplicate` para no arrastrar versiones antiguas. Sufijo `_sanitizado`. | M | §5.2 (Sanitize / Remove Hidden Information) |
| 2 | **Redacción en dos fases + búsqueda por patrones (pack es-ES editable)** | `src/pdf/redact/patterns.ts` y `search.ts` *(nuevos, puros)*, `src/pdf/mupdf/` (aplicar), `src/model/types.ts` (ampliar `RedactObject`), panel en `src/features/editor` | Fase 1 *marcar* (contorno rojo + previsualización negra al pasar el cursor; guardar como anotación estándar `/Redact` con `createAnnotation("Redact")` y `setQuadPoints` para que viaje con el PDF); fase 2 *aplicar* con `PDFPage.applyRedactions(true, REDACT_IMAGE_PIXELS, REDACT_LINE_ART_REMOVE_IF_TOUCHED, REDACT_TEXT_REMOVE)`. **Buscar y redactar:** palabra/frase, varias, o **regex**; extraer texto con `StructuredText.walk({beginLine,onChar})` (trae el *quad* de cada carácter), aplicar la expresión por línea y convertir coincidencias en rectángulos; lista con casillas y "marcar seleccionados"; ámbito documento o carpeta. **Pack es-ES** propio y validado: DNI/NIE (letra de control), CIF/NIF, IBAN `ES` (módulo 97), teléfono (+34), tarjeta (Luhn), correo, fechas, matrícula, nº de la Seguridad Social. **Propiedades:** color, texto superpuesto (dibujado con pdf-lib tras aplicar), repetir, opacidad, "código" de redacción (juegos personalizables). Confirmar "permanente", sufijo `_Redacted`, y ofrecer ejecutar la idea 1. Aviso si no hay texto (escaneo) → sugerir OCR. | M | §5.2; patrones regex por región (blog de Adobe) y carpeta `DocSettings\Redaction` |
| 3 | **Paridad de opciones en Proteger** | `src/pdf/mupdf/` (cifrado), `src/pdf/tools/` (nuevo `permissions.ts` puro), página *Proteger* en `src/features/tools` | Selector de **compatibilidad** (RC4-128 / AES-128 / **AES-256** por defecto) con aviso de lectores antiguos; **contraseña de apertura distinta de la de permisos** (validar); permisos con la **semántica de Acrobat**: impresión (ninguna / baja 150 ppi / alta), cambios (ninguno / insertar-eliminar-girar / rellenar y firmar / comentar+rellenar+firmar / todo salvo extraer), copiar, accesibilidad, y su traducción a los **bits de la especificación** (3, 4, 5, 6, 9, 10, 11, 12) → opción `permissions=` de MuPDF (`encrypt=aes-256`, `owner-password`, `user-password`). Opción *cifrar todo / todo menos metadatos*. Mostrar el estado actual al abrir un PDF protegido y **quitar seguridad** con la contraseña de permisos. Test: tabla de verdad opción→bits. | S | §5.5 |
| 4 | **Almacén de presets declarativos (equivalente a `DocSettings`)** | `src/model/presets.ts` *(nuevo)*, `src/platform/` (leer/escribir en la carpeta de datos de la app), UI de importar/exportar | Archivos **JSON versionados** (`schema`, `id`, `name`, `locale`) para: patrones y juegos de códigos de redacción, encabezado/pie/Bates, marca de agua/fondo, optimizador, permisos de Proteger y secuencias (idea 10). Valores por defecto empaquetados + los del usuario en `appData/presets/*.json`; botón "restablecer", importar/exportar para compartir. Es la **base** de las ideas 2, 5, 9 y 10. | S | `DocSettings` XML, `Sequences`, ajustes guardados de encabezados [ADMIN] |
| 5 | **Optimizador real + auditoría de espacio + niveles** | `src/pdf/mupdf/optimize.ts` y `audit.ts` *(nuevos)*, página *Comprimir* en `src/features/tools` | **Submuestreo de imágenes:** recorrer los XObject imagen; ppi efectivo = píxeles / tamaño en puntos × 72 (obtenido de la matriz de cada página); reducir **solo si ppi > objetivo × 1,5**; cargar con `loadImage`, reescalar (mupdf.js 1.28 no trae `Pixmap.scale`: dibujar la imagen con `DrawDevice` + `fillImage` sobre un `Pixmap` del tamaño destino, o usar `OffscreenCanvas` dentro del worker), recodificar con `Pixmap.asJPEG(calidad)` y reescribir el flujo del XObject; **no sustituir si el resultado pesa más**; imágenes mono con Flate (los tipos de mupdf.js 1.28 no exponen escritura CCITT/JBIG2 y `linearize` ya no está soportado, por lo que "vista rápida en web" no es emulable; en una app local no importa). Tabla de calidad con los **QFactor** de Adobe (2,40/1,30/0,76/0,40/0,15) mapeados a calidad JPEG (calibrar con muestras). **Fuentes:** `subsetFonts()`. **Descartar:** JS, miniaturas, adjuntos, metadatos, comentarios, etiquetas (con aviso de accesibilidad), capas ocultas. **Limpieza:** `saveToBuffer("garbage=deduplicate,compress=yes,compress-fonts,compress-images,objstms")`. Tres niveles **Alto/Medio/Bajo** con **estimación del tamaño** y botón **"Auditar tamaño"** (bytes y % por: imágenes, fuentes, contenido de página, XObjects/formularios, anotaciones, estructura/marcadores, metadatos, resto). Avisar de que **se invalidan las firmas**. | M-L | §5.1 (valores por defecto y tabla JPEG [SDK]) |
| 6 | **Edición de texto por párrafos + coincidencia y sustitución de fuentes** | `src/pdf/textBlocks.ts` *(nuevo, puro)*, `src/pdf/fonts.ts`, `src/features/editor`, `src/model/types.ts` (`TextObject.replaces`) | Agrupar líneas de `StructuredText.walk` en **bloques/párrafos** (espaciado, sangría, alineación) y editarlos como **cuadro con reflujo** (redimensionar re-envuelve sin cambiar el tamaño; cuadros independientes; límite de página). Heredar tamaño/color/estilo del texto cercano al añadir. **Fuentes:** mapear la fuente original (nombre + banderas del `FontDescriptor`: serif, monoespaciada, cursiva, negrita) a Helvetica/Times/Courier **y**, para no caer en `?` con caracteres fuera de WinAnsi, **incrustar una fuente Unicode empaquetada** con fontkit; mostrar la etiqueta **"Fuente sustituida"** y permitir elegir otra. | L | §5.3 |
| 7 | **OCR con tres modos de salida** *(hoja de ruta v0.2)* | `src/pdf/ocr/` *(engine con tesseract.js, `textLayer.ts` con pdf-lib)*, activar la entrada `ocr` de `registry.ts` | Opciones: **idioma**, **estilo** (*Imagen buscable* con "reducir resolución a…", *Imagen buscable exacta* = capa de texto **invisible** con modo de render 3 sobre la imagen intacta, y *Texto editable* como opción avanzada), **rango de páginas**, **saltar páginas que ya tienen texto** (`StructuredText.asText()`) con "Volver a reconocer". **Preprocesado** tipo *Escanear y OCR*: enderezar, recortar bordes, quitar fondo. Cada palabra con su caja y escala horizontal para que la selección coincida. Lote. Datos de idioma como **componentes opcionales** empaquetados (como Adobe con sus módulos opcionales). | L | §5.8 |
| 8 | **Comparar PDF por texto y por píxel** *(hoja de ruta v0.2)* | `src/pdf/compare/` *(nuevo: `textDiff.ts`, `pixelDiff.ts`, `report.ts`)*, `src/features/compare/` | **Antiguo/nuevo + rango de páginas**; **tipo** (auto, informe, presentación, escaneado) y **"solo texto"**. Texto: diff por palabras (Myers) sobre el texto en orden de lectura con sus cajas. Visual: renderizar ambas páginas a ~100 ppi y comparar píxeles con tolerancia + dilatación + cajas de componentes conexas (para escaneos). **Vista lado a lado** con scroll sincronizado, resumen con **filtros** (texto, imágenes, anotaciones, formato) y **informe PDF** generado con pdf-lib (marcas como sellos de color). | L | §5.7 |
| 9 | **Organizar y numerar con paridad** | `src/pdf/tools/` (`split.ts`, `pageNumbers.ts`, `extract.ts`), `src/features/organize`, página *Numerar* | Dividir por **tamaño máximo** y por **marcadores de primer nivel** (`loadOutline()`) además de "cada N"; extraer con filtro **pares/impares/orientación**, "eliminar tras extraer" y "cada página como archivo"; **reemplazar páginas**; etiquetas de página (`setPageLabels`). **Bates:** prefijo, sufijo, inicio, **dígitos 3-15 (6 por defecto)**, lote por carpeta, orden, sin `#`; encabezados/pies con variables (página n de N, fecha, nombre) y rangos; ajustes guardados (idea 4). | M | §5.6 |
| 10 | **Secuencias de acciones encadenables (Action Wizard)** | `src/pdf/pipeline.ts` *(nuevo, puro)*, `src/features/tools/registry.ts`, página *Acciones* en `src/features/tools` | Convertir cada `BatchToolDef` en un **`Command`** `{id, params, run(bytes, params, progress)}` (equivalente a AVCommand: utilizable de forma interactiva, programática o por lotes). Una **secuencia** = lista de comandos con parámetros guardada como preset JSON. Acciones de fábrica: *Redactar y sanear*, *Preparar para compartir* (OCR → sanitizar → comprimir → proteger), *Archivar*. Ejecutar sobre carpetas con informe de resultados. Facilita probar todo con vitest. | M | §5.10; `Sequences\*.sequ` |
| 11 | **Rellenar y firmar: detección, formularios planos y firmas guardadas** | `src/features/editor` (modo rellenar), `src/features/signature`, `src/pdf/formDetect.ts` *(nuevo)* | **Resaltar campos** al pasar (caja azul) y interruptor "resaltar campos"; modo **formulario plano**: escribir en cualquier sitio, símbolos ✓ ✗ ○ • (ya existen) más **fecha automática** con formato; **firma e iniciales** guardadas (escribir/dibujar/imagen), negro por defecto, mover y redimensionar; propuesta de campos detectando líneas y casillas en el flujo de operadores de pdf.js; opción **aplanar al guardar** y `resetForm` ("limpiar formulario"). | M | §5.4 |
| 12 | **Apertura segura (equivalente a Vista protegida)** | `src/features/editor` (aviso "Modo lectura: Habilitar edición"), `src/pdf/pdfjs.ts` (scripting desactivado), `src/pdf/mupdf/` (un worker por documento), `src-tauri/capabilities` | Abrir **solo lectura** archivos de ubicaciones no confiables (Descargas, temporales, adjuntos) hasta que el usuario habilite la edición; ajuste *nunca / ubicaciones no confiables / siempre*. **Scripts de PDF desactivados** por defecto. Un **worker de MuPDF por documento** (aislamiento de fallos, como "un par de procesos por PDF"). Permisos de Tauri mínimos (ámbito de archivos solo el elegido en el diálogo, sin red, CSP estricta). | M | §4.3 (Modo protegido/Vista protegida) |
| 13 | **Contrato de herramienta con ciclo de vida, eventos y capas con liberación explícita** | `src/features/tools/registry.ts`, `src/model/events.ts` *(nuevo)*, `src/pdf/index.ts` *(fachada)*, envoltorios en `src/pdf/mupdf/` | `ToolModule {id, requires, register(ctx), dispose}` con **carga perezosa**; bus de eventos (`app:ready`, `doc:opened`, `before:save`, `after:save`) para enchufar "sanitizar/aplanar al guardar" **sin tocar `compose.ts`**; **manejadores por tipo de `EditorObject`** (dibujar, hit-test, editar, serializar); fachada por capas (raw → doc → edit) y reglas de importación; **envoltorios con `try/finally`** para liberar objetos WASM (equivalente al Acquire/Release); prefijo `/SNOW_` para cualquier dato privado guardado en el PDF. | M | §4.2 (handshake, HFT reemplazable, handlers, prefijos) |
| 14 | **Biblioteca de sellos como PDF** | `src/features/editor/` (herramienta *Sello*), `src/pdf/stamps/` *(PDF propios)*, `src/model/types.ts` (nuevo `ObjectKind` `stamp`) | Sellos **propios** (no los de Adobe) como páginas de un PDF por categoría: *Aprobado/Borrador/Confidencial*, *Firmar aquí*, y **dinámicos** (nombre del usuario, fecha y hora). Importar sellos personalizados desde PDF/PNG; exportar incrustando como **Form XObject** (`embedPage`: vectorial y con texto seleccionable). Reutilizable para las marcas del informe de comparación (idea 8). | M | `plug_ins\Annotations\Stamps` (nombres) |
| 15 | **Comprobación y conversión a PDF/A (perfiles tipo Preflight)** *(hoja de ruta v0.3)* | `src/pdf/pdfa/` *(nuevo: `check.ts`, `fix.ts`)*, página en `src/features/tools` | Perfiles JSON (PDF/A-1b, 2b...) con **comprobaciones** (fuentes incrustadas, JS, cifrado, transparencia en A-1, enlaces externos, `OutputIntent`, XMP con identificación) y **correcciones** (incrustar fuentes, añadir `OutputIntent` sRGB, quitar JS/adjuntos prohibidos). Botón **Analizar y corregir** con informe (cumple/no cumple por regla) y atajo "Guardar como PDF/A". | L | §5.9 |

### Dependencias y orden sugerido

1. **Primero**: 4 (presets) y 3 (Proteger) son pequeños y desbloquean el resto; 1 y 2 son lo que más refuerza la propuesta de privacidad.
2. **Después**: 5 (optimizador) y 9 (organizar/numerar) completan el catálogo de herramientas por lotes; 10 (secuencias) se apoya en todas ellas.
3. **Hoja de ruta v0.2/v0.3**: 7 (OCR) alimenta a 2 (patrones sobre escaneos) y a 8 (comparar escaneos); 15 (PDF/A) reutiliza 1 (quitar JS/adjuntos) y 5 (fuentes).
4. **Riesgo alto**: 6 (edición por párrafos) y 7 (OCR) necesitan prototipos aislados con documentos reales antes de integrarse.

---

## 7. Otras ideas menores y cosas a no copiar

**Menores (fuera del top 15):**

- **Leer en voz alta** con `speechSynthesis` del sistema (local) y **vista de reflujo/lectura**, apoyándose en el texto en orden de lectura de pdf.js (equivalente a `ReadOutLoud.api` y `reflow.api`).
- **Acceso rápido tras el arranque:** precargar el worker de MuPDF en segundo plano (idea del *SpeedLauncher*), siempre sin procesos residentes.
- **Códigos de barras 2D en formularios** (QR, DataMatrix, PDF417) como objeto del editor.
- **Medición y geolocalización** (el motor de proyecciones `pe.dll` sugiere medidas en mapas): nicho; descartable.

**Qué no conviene copiar (contradice "100 % local y sin red"):**

- Servicios de nube (`AcroCloudConnect`, conectores Dropbox, revisión compartida, firma remota), telemetría (`AdobeGrowthSDK`, `appmeasurement`) y múltiples actualizadores; la **IA con modelos** (ONNX) solo tendría sentido si fuese 100 % local y opcional.
- El enfoque de **embeber Chromium**: Tauri + WebView2 ya evita ≈640 MB.
- Las marcas, sellos, plantillas e iconos de Adobe: **no se copian**; se crean propios.

---

## 8. Fuentes públicas consultadas

**SDK y administración de Adobe (lectura directa)**

- Plug-in guide (capas, objetos, handlers): https://opensource.adobe.com/dc-acrobat-sdk-docs/library/plugin/index.html
- Mecanismo de plug-ins (handshake, carga, notificaciones, prefijos): https://opensource.adobe.com/dc-acrobat-sdk-docs/library/plugin/Plugins_Pimech.html
- Host Function Tables: https://opensource.adobe.com/dc-acrobat-sdk-docs/library/plugin/Plugins_Hft.html
- Handlers: https://opensource.adobe.com/dc-acrobat-sdk-docs/library/plugin/Plugins_Handlers.html
- Extensibilidad de brokers del sandbox: https://opensource.adobe.com/dc-acrobat-sdk-docs/library/overview/SandboxBrokerExt.html
- Ajustes comunes de "Adobe PDF" (imágenes, fuentes): https://opensource.adobe.com/dc-acrobat-sdk-docs/library/pdfcreation/PDF_Create_CommonSettings.html
- Uso de ajustes de creación PDF (calidades JPEG, submuestreo, umbral): https://opensource.adobe.com/dc-acrobat-sdk-docs/library/pdfcreation/PDF_Create_UsingSettings.html
- Protecciones de sandbox (Modo protegido, Vista protegida): https://www.adobe.com/devnet-docs/acrobatetk/tools/AppSec/sandboxprotections.html
- Instalador unificado de 64 bits: https://www.adobe.com/devnet-docs/acrobatetk/tools/AdminGuide/singleinstaller.html
- Notas de versión 26.002.22031: https://www.adobe.com/devnet-docs/acrobatetk/tools/ReleaseNotesDC/continuous/dccontinuousoct2026qfe.html
- Encabezados, marcas de agua y fondos (ajustes guardados en XML): https://www.adobe.com/devnet-docs/acrobatetk/tools/Wizard/header.html

**Guías de Adobe (lectura directa)**

- Guía rápida de redacción (Acrobat XI): https://acrobatusers.com/assets/uploads/public_downloads/2214/adobe-acrobat-xi-pdf-redaction-remove-visible-data-from-pdf-files-tutorial-ue.pdf
- Guía rápida de sanitizado (Acrobat XI): https://acrobatusers.com/assets/uploads/public_downloads/2215/adobe-acrobat-xi-pdf-sanitization-remove-hidden-data-from-pdf-files-tutorial-ue.pdf
- Redacción en la interfaz actual (Experience League): https://experienceleague.adobe.com/en/docs/document-cloud-learn/acrobat-learning/advanced-tasks/redact?lang=en
- Patrones de redacción personalizados (blog de Adobe): https://blog.adobe.com/en/publish/2011/05/11/creating-and-using-custom-redact
- Servicios de PDF (Proteger / OCR / Comprimir): https://developer.adobe.com/document-services/docs/overview/pdf-services-api/howtos/protect-pdf · …/ocr-pdf · …/compress-pdf

**Ayuda de Adobe leída a través de resúmenes de buscador (`helpx` bloquea la descarga; verificar en el original)**

- Eliminar contenido confidencial: https://helpx.adobe.com/acrobat/current/removing-sensitive-content-pdfs.html
- Sanear PDF: https://helpx.adobe.com/acrobat/desktop/protect-documents/redact-pdfs/sanitize.html
- Optimizar PDF: https://helpx.adobe.com/acrobat/current/optimizing-pdfs-acrobat-pro.html · https://helpx.adobe.com/acrobat/desktop/create-documents/optimize-pdfs/pdf-optimizer-settings.html
- Proteger con contraseña: https://helpx.adobe.com/acrobat/current/securing-pdfs-passwords.html
- Comparar documentos: https://helpx.adobe.com/acrobat/using/compare-documents.html
- Editar texto (cuadros de texto): https://helpx.adobe.com/sg/acrobat/desktop/edit-documents/edit-text-in-pdfs/adjust-text-boxes.html
- Formularios planos: https://helpx.adobe.com/acrobat/desktop/work-with-pdf-forms/fill-sign-forms/flat-forms.html
- Numeración Bates: https://helpx.adobe.com/acrobat/desktop/edit-documents/apply-bates-numbering/add-bates.html
- Perfiles de Preflight y estándares PDF/A/X/E: https://helpx.adobe.com/acrobat/current/preflight-profiles-acrobat-pro.html · https://helpx.adobe.com/acrobat/current/pdf-x-pdf-a-pdf.html
- Procesos AcroCEF/RdrCEF: https://helpx.adobe.com/acrobat/kb/RdrCEF-exe-and-AcroCEF-exe-can-I-disable.html

**Comunidad y terceros (solo contraste)**

- https://acrobatusers.com/tutorials/understanding-acrobats-optimizer/ · https://acrobatusers.com/tutorials/cleaning-your-pdf-documents/ · https://acrobatusers.com/tutorials/what-else-your-document/
- Guías universitarias de OCR (KU, SIUE) y preguntas de la comunidad de Adobe.

**Abiertas (aplicación técnica en SnowPDF)**

- Opciones de escritura de PDF de MuPDF: https://mupdf.readthedocs.io/en/1.28.0/reference/common/pdf-write-options.html
- API de `PDFDocument` de MuPDF.js: https://mupdf.readthedocs.io/en/1.28.0/reference/javascript/types/PDFDocument.html
- Tipos de `mupdf` instalados en `node_modules/mupdf/dist/mupdf.d.ts` (1.28.1): `applyRedactions` con constantes `REDACT_*`, `subsetFonts`, `bake`, capas, adjuntos, `StructuredText.walk`, `loadImage`/`Pixmap.asJPEG`, anotación `Redact`.

---

## 9. Apéndice: cifras y verificación

- 25 `.api` = 79,9 MB; `plug_ins` completo = 56 archivos, 100 MB.
- `AcroCEF` 229 MB (25 archivos) + `WebResources` 414 MB (6.698 archivos) = 643 MB = 52,6 % de 1.221 MB.
- Raíz: 83 archivos (289 MB) = 16 `.exe` + 52 `.dll` + datos.
- Los tamaños se expresan en MB binarios (1 MB = 1.048.576 bytes), redondeados.
- **Lo inferido solo por nombre** (marcado así en el texto): función de `TouchUp`, `PDDom`, `Checkers`, `Onix`, `acroML`/`models`, `pmp` de códigos de barras, `.sequ`, `.aapp`, `.aaui`, `CompareMarkers.pdf`, `SingleClientServicesUpdater`, `NGL`, `thorvg`, `adobe_c2pa`, `cryptocme`, uso interno de `AdobePDFL`, y la existencia de módulos de OCR/Comparar/Conversión por los recursos `.ESP`.
- **No verificado** (se indica en el texto): búsqueda en PDF cifrados, lista completa de "Descartar objetos", comportamiento exacto del sanitizado frente a contenido recortado, y cualquier cifra tomada de [COM].
