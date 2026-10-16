import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverTarget = env.VITE_DEV_SERVER_PROXY || 'http://localhost:3001';

  return {
    plugins: [react()],
    server: {
      host: true,
      port: Number(env.PORT) || 5174,
      strictPort: false,
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
      port: Number(env.PORT) || 4174,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
