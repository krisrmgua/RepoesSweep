import { defineConfig } from "vite";

export default defineConfig({
  root: "src/ui",
  base: "./",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
