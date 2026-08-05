import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Keep portal off 5173 so it never collides with the tracker Vite server.
  server: { port: 5180, strictPort: true },
})
