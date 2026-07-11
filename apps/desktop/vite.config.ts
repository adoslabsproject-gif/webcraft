import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Tauri expects a fixed port and does not handle hot-reloading on its own
const TAURI_DEV_HOST = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    // Deliberately NOT 1420 (Tauri default). WebCraft is an IDE that the
    // user keeps open while developing OTHER Tauri apps — those use 1420
    // by default. We move to a private high port so the two coexist.
    port: 11420,
    strictPort: true,
    host: TAURI_DEV_HOST || false,
    hmr: TAURI_DEV_HOST
      ? { protocol: 'ws', host: TAURI_DEV_HOST, port: 11421 }
      : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // Tauri 2 in 2026 runs on modern WebViews — WebView2 (Chromium 120+) on
    // Windows, WKWebView (Safari 16+) on macOS. Older targets break modern
    // JS features used by libraries like lucide-react (destructuring with
    // computed defaults).
    target:
      process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome120' : 'safari16',
    minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
