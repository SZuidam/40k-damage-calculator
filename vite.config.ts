import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves this project from /<repo-name>/, not the domain root.
  // Relative asset URLs work there, on a custom domain and in `vite preview`.
  base: './',
});
