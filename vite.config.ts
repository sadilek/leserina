/// <reference types="vitest/config" />
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// The app lives at https://sadilek.github.io/leserina/. That address must never change: an
// installed home-screen app keeps its data (localStorage) only at its own origin and path.
const base = '/leserina/'

// The recording page (record.html, only under `npm run dev`) saves each sound it records as
// audio/sounds/raw/<file>.wav, through this plugin; scripts/prepare_sounds.py takes it from there.
const RAW = new URL('./audio/sounds/raw/', import.meta.url)

function recordSounds(): Plugin {
  return {
    name: 'record-sounds',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(`${base}__sounds`, (req, res) => {
        mkdirSync(RAW, { recursive: true })
        if (req.method === 'GET' && (req.url === '/' || req.url === '')) {
          const files = readdirSync(RAW).filter((f) => f.endsWith('.wav')).map((f) => f.slice(0, -4))
          res.setHeader('Content-Type', 'application/json')
          return res.end(JSON.stringify(files))
        }
        const name = /^\/([a-z-]+)\.wav$/.exec(req.url ?? '')?.[1]
        const file = name && new URL(`${name}.wav`, RAW)
        if (req.method === 'GET' && file && existsSync(file)) {
          res.setHeader('Content-Type', 'audio/wav')
          res.setHeader('Cache-Control', 'no-store')
          return res.end(readFileSync(file))
        }
        if (req.method !== 'PUT' || !file) {
          res.statusCode = req.method === 'GET' ? 404 : 400
          return res.end()
        }
        const chunks: Buffer[] = []
        req.on('data', (c: Buffer) => chunks.push(c))
        req.on('end', () => {
          writeFileSync(file, Buffer.concat(chunks))
          res.end()
        })
      })
    },
  }
}

export default defineConfig({
  base,
  define: { __BUILD_TIME__: JSON.stringify(new Date().toISOString()) },
  server: { port: 5180, strictPort: true },
  preview: { port: 5181, strictPort: true },
  // Clips and pictures stay separate files (precached by the service worker), not inlined.
  build: { assetsInlineLimit: 0 },
  // worker/ has its own tests, run in the Workers runtime (npm run check there).
  test: { include: ['src/**/*.test.ts'] },
  plugins: [
    recordSounds(),
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
