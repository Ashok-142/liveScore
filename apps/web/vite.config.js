import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    resolve: {
        // Prefer TS/TSX source files over generated JS files in src/
        // so UI edits in .tsx are always reflected during dev.
        extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"]
    }
});
