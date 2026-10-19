import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      // plugin adds the SW registration script for us.
      injectRegister: 'auto', 

      manifest: {
        name: 'RemindME',
        short_name: 'RemindME',
        description: 'Attendance reminders for KamiLimu mentees',
        theme_color: '#1f3a5f',
        background_color: '#f6f5f1',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ],
      },

      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // IMPORTANT: without this, the precache list would include the lazy
        // Admin chunk and every mentee's phone would download it on install,
        // defeating the code splitting. Rollup names the chunk after the file.
        globIgnores: ['**/AdminDashboard-*.js'],
      },

      // Lets you test push + SW with 'npm run dev'
      devOptions: {
        enabled: true,
        type: 'module',
      }

    })
  ]
})