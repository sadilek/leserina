/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The app lives at https://sadilek.github.io/leserina/. That address must never change: an
// installed home-screen app keeps its data (localStorage) only at its own origin and path.
const base = '/leserina/'

export default defineConfig({
  base,
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  // Clips and pictures stay separate files (precached by the service worker), not inlined.
  build: { assetsInlineLimit: 0 },
  // worker/ has its own tests, run in the Workers runtime (npm run check there).
  test: { include: ['src/**/*.test.ts'] },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Leserina',
        short_name: 'Leserina',
        lang: 'de',
        id: base,
        start_url: base,
        scope: base,
        description: 'Wörter lesen, Bilder finden, Sterne sammeln.',
        display: 'fullscreen',
        orientation: 'any',
        background_color: '#2f6b6e',
        theme_color: '#2f6b6e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Everything the app needs is precached, so it runs offline once installed.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,jpg,mp3,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
})
