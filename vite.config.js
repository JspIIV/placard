import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5174,
    strictPort: true,
  },
  plugins: [nodePolyfills()],
})
