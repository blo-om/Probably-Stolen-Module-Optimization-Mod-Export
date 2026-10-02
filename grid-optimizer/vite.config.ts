import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Razboy's GPU solver (src/solvers/razboy) is written with TypeGPU, whose 'use gpu' functions this plugin compiles to WGSL
import typegpu from 'unplugin-typegpu/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [typegpu(), react()],
    base: '/Probably-Stolen-Module-Optimization-Mod-Export/',
})
