import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import { fileURLToPath } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // MuPDF ships its own WASM loader with top-level await: keep it out of the
  // dependency pre-bundler and target modern runtimes (WebView2 / WKWebView).
  optimizeDeps: {
    exclude: ["mupdf"],
  },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4096,
  },
  worker: {
    format: "es" as const,
  },

  // Tauri: keep Rust errors visible and use a fixed port.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
