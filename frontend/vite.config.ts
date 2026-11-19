import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Relative assets serve both /explore/ and an old standalone origin for backup.
export default defineConfig({ base: "./", plugins: [tailwindcss()] });
