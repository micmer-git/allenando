import { existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/allenando/',
  define: {
    // il link «Confronto climbfinder» sotto un percorso va in onda solo se la tabella della pista M c'è (F.14)
    __PENDENZE_PRONTE__: JSON.stringify(existsSync(fileURLToPath(new URL('./docs/pendenze-2026-11.md', import.meta.url)))),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png', 'samples/**/*', 'routes/*.json'],
      manifest: {
        name: 'OROBIA',
        short_name: 'OROBIA',
        description: 'Le strade vere di Bergamo sul rullo: mondo aperto in 3D, volate, GPM e crono, classifiche, kit da sbloccare, Stelvio e Mortirolo.',
        lang: 'it',
        dir: 'ltr',
        start_url: '/allenando/',
        scope: '/allenando/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0c0b09',
        theme_color: '#0c0b09',
        categories: ['sports', 'fitness', 'health'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico,woff,woff2,fit,gpx,tcx,zip,json,webmanifest}'],
        // il mondo di Bergamo pesa decine di MB in mattonelle: non si scarica tutto all'installazione,
        // si tiene in cache quello che si è già pedalato (e il grafo, che serve sempre)
        // le pagine prima/dopo sono rapporti con le loro foto: non entrano nell'app installata
        globIgnores: ['**/world/**', '**/prima-dopo/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/world/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'allenando-world-v1',
              expiration: { maxEntries: 1500, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        navigateFallback: '/allenando/index.html',
        // senza /prima-dopo/ il service worker aprirebbe l'app al posto del rapporto
        navigateFallbackDenylist: [/^\/allenando\/samples\//, /^\/allenando\/world\//, /^\/allenando\/prima-dopo\//],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
