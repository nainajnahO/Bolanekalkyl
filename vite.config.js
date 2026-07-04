import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Bolanekalkyl/',
  build: {
    // lightningcss (the default minifier) rejects 98.css's `@media (not(hover))`
    cssMinify: false,
  },
});
