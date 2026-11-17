import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages (página de projeto): VITE_BASE=/COSMICFUT/ (ou outro caminho / domínio próprio). Padrão: raiz.
const base = (process.env.VITE_BASE || '/').replace(/\/?$/, '/');

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    // Pacotes do monorepo resolvidos direto do código-fonte (sem depender de npm install/links).
    alias: [
      // núcleo do online (sala autoritativa + relay) — usado pelo anfitrião da simulação no navegador
      { find: /^@cosmicfut\/online-core\/(.+)$/, replacement: fileURLToPath(new URL('../../packages/online-core/src/', import.meta.url)) + '$1.ts' },
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
      { find: /^@cosmicfut\/engine$/, replacement: fileURLToPath(new URL('../../packages/engine/src/index.ts', import.meta.url)) },
      { find: /^@cosmicfut\/shared$/, replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
    ],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/ },
            { name: 'motion', test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/ },
            { name: 'vendor', test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
