import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// BASE_PATH lets the same build serve from a domain root (Netlify, Vercel)
// or from a sub-path such as GitHub Pages' /<repo>/.
const base = process.env.BASE_PATH ?? '/';

// SINGLE_FILE=1 builds a one-page preview (no service worker, everything
// inlined by scripts/inline.mjs) that can be opened or shared as one HTML file.
const single = !!process.env.SINGLE_FILE;

export default defineConfig({
  base,
  resolve: single
    ? { alias: { 'virtual:pwa-register/react': fileURLToPath(new URL('./src/pwa-stub.ts', import.meta.url)) } }
    : undefined,
  build: single
    ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000, rollupOptions: { output: { inlineDynamicImports: true } } }
    : undefined,
  plugins: [
    react(),
    !single &&
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Agent Momentum',
        short_name: 'Momentum',
        description: 'Plan the week, log the work, review on Friday, see what to improve.',
        theme_color: '#14284B',
        background_color: '#14284B',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
