/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deployed to GitHub Pages from the `readstack` repo, served at /readstack/.
export default defineConfig({
  plugins: [react()],
  base: "/readstack/",
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
