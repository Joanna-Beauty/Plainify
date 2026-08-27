import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import process from 'node:process'

export default defineConfig({
  plugins: [react()],
  server: {
    hmr: process.env.BAIHUABEN_SERVICE_MODE !== '1',
  },
})
