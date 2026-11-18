/*
 * pdf.js worker entry: installs the polyfills older Android WebViews need before the pdf.js
 * worker code runs (it registers its message handler when imported inside a worker).
 */
import "@/polyfills";
import "pdfjs-dist/build/pdf.worker.min.mjs";
