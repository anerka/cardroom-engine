import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/seven-stud/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon-16.png',
        'favicon-32.png',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'playing-cards.png',
        'offline.html',
        'sounds/PokerAction.wav',
        'sounds/PokerRaise.mp3',
      ],
      manifest: {
        name: 'Seven Card Stud',
        short_name: 'Seven Stud',
        description:
          'Ante, bring-in, fixed limit seven card stud — play money.',
        lang: 'en',
        dir: 'ltr',
        start_url: './',
        scope: './',
        theme_color: '#0c1512',
        background_color: '#0c1512',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,wav,mp3}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
})
