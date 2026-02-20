import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/test-utils/**",
        "**/*.test.ts",
        "src/contentScript.ts",
        "src/background.ts",
        "vite.config.ts",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
      },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        popup: "index.html",
        library: "library.html",
        walkthrough: "walkthrough.html",
        background: "src/background.ts",
        // contentScript is built separately via vite.content.config.ts as an
        // IIFE so it has no ES module import statements when Chrome injects it.
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background.js";
          return "assets/[name].js";
        }
      }
    }
  }
});
