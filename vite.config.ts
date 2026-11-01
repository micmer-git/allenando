import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/camilla-ride/',
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
      includeAssets: ['favicon.svg', 'pwa-192.png', 'pwa-512.png', 'samples/**/*'],
      manifest: {
        name: 'Camilla Ride',
        short_name: 'Camilla Ride',
        description: 'Ciclismo indoor 3D, allenamenti sul rullo e il sonno di Camilla.',
        lang: 'it',
        dir: 'ltr',
        start_url: '/camilla-ride/',
        scope: '/camilla-ride/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#090a0e',
        theme_color: '#090a0e',
        categories: ['sports', 'fitness', 'health'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,fit,gpx,tcx,zip,webmanifest}'],
        navigateFallback: '/camilla-ride/index.html',
        navigateFallbackDenylist: [/^\/camilla-ride\/samples\//],
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
