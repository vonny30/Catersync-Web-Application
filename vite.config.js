import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { LOGO_SRC } from './src/brand.js'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The tab icon follows the logo set in src/brand.js.
    { name: 'brand-logo', transformIndexHtml: (html) => html.replaceAll('%LOGO_SRC%', LOGO_SRC) },
  ],
})