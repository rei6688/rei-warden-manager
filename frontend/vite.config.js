import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3002'

  return {
    plugins: [react()],
    server: {
      middlewareMode: false,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path,
          configure: (proxy, options) => {
            proxy.on('error', (err, req, res) => {
              console.error('Proxy error:', err)
            })
            proxy.on('proxyRes', (proxyRes, req, res) => {
              // Add debug headers
              proxyRes.headers['X-Proxied-By'] = 'Vite'
            })
          },
        },
      },
    },
  }
})
