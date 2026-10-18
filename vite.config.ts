import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Leserina',
        short_name: 'Leserina',
        lang: 'de',
        description: 'Wörter lesen, Bilder finden, Goldmünzen sammeln.',
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
      },
    }),
  ],
})
