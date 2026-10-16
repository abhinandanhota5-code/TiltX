import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverTarget = env.VITE_DEV_SERVER_PROXY || 'http://localhost:3001';

  return {
    plugins: [react()],
    server: {
      host: true,
      port: Number(env.PORT) || 5173,
      strictPort: true,
      proxy: {
        '/socket.io': {
          target: serverTarget,
          ws: true,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host: true,
      port: Number(env.PORT) || 4173,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
