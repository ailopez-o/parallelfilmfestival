import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    manifest: 'manifest.json',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        session: resolve(__dirname, 'next-session.html'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
  },
});
