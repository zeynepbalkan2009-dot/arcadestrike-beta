import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@arcadestrike/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:2567",
    },
  },
  build: {
    target: "esnext",
    chunkSizeWarningLimit: 1000,
  },
});
