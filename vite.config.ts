import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/allenando/',
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
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png', 'samples/**/*', 'routes/*.json'],
      manifest: {
        name: 'ALLENANDO',
        short_name: 'ALLENANDO',
        description: 'Rullo sulle strade vere: Bergamo, Val Brembana e Val Seriana in un mondo aperto, Stelvio e Mortirolo in 3D, power replay e fantasma dei tuoi giri.',
        lang: 'it',
        dir: 'ltr',
        start_url: '/allenando/',
        scope: '/allenando/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#0a0c0f',
        theme_color: '#0a0c0f',
        categories: ['sports', 'fitness', 'health'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,fit,gpx,tcx,zip,json,webmanifest}'],
        // il mondo di Bergamo pesa decine di MB in mattonelle: non si scarica tutto all'installazione,
        // si tiene in cache quello che si è già pedalato (e il grafo, che serve sempre)
        globIgnores: ['**/world/**'],
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
        navigateFallbackDenylist: [/^\/allenando\/samples\//, /^\/allenando\/world\//],
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
