import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { LOGO_SRC, APP_NAME, BUSINESS_NAME_DEFAULT } from './src/brand.js'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The tab icon and title follow src/brand.js (the title is then kept in
    // step with Settings -> Business Details by components/Brand.jsx).
    {
      name: 'brand',
      transformIndexHtml: (html) => html
        .replaceAll('%LOGO_SRC%', LOGO_SRC)
        .replaceAll('%APP_TITLE%', `${BUSINESS_NAME_DEFAULT} · ${APP_NAME}`),
    },
  ],
})