/**
 * Separate Vite build config for the content script.
 * Built as a self-contained IIFE so Chrome can inject it as a plain script
 * without any ES module import statements that would cause SyntaxError.
 */
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: false, // Don't wipe the main build output
    rollupOptions: {
      input: {
        contentScript: path.resolve(__dirname, "src/contentScript.ts"),
      },
      output: {
        format: "iife",
        entryFileNames: "contentScript.js",
        inlineDynamicImports: true,
      },
    },
  },
});
