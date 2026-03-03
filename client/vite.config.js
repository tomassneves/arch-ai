import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  resolve: {
    dedupe: ['three'],
    alias: {
      // força "three" a ser SEMPRE o do client/node_modules
      three: path.resolve(__dirname, 'node_modules/three'),
    },
  },
  server: {
    // during dev, forward API calls to the Node backend running on 3000
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  optimizeDeps: {
    include: ['three'],
  },
})