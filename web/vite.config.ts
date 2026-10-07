import { defineConfig } from "vite";

// relative base so dist/ works from any static host or sub-path
export default defineConfig({ base: "./", build: { chunkSizeWarningLimit: 1200 } });
