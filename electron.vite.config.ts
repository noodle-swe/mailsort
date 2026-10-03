import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * Content-Security-Policy for the packaged renderer. Email bodies render in sandboxed srcdoc
 * iframes, which inherit this policy (plus their own stricter one), so remote images must be
 * allowed here for the "Load images" button to work. Dev mode skips it because Vite's React
 * refresh preamble is an inline script.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: cid: https: http:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' about:",
  "object-src 'none'",
  "base-uri 'none'"
].join('; ')

function cspInBuild(): Plugin {
  return {
    name: 'mailsort-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' }]
  }
}

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // mcp-bridge is the stdio entry for other MCP clients; it runs in plain Node mode.
        input: { index: 'src/main/index.ts', 'mcp-bridge': 'src/mcp/bridge.ts' }
      }
    }
  },
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss(), cspInBuild()],
    build: { minify: true }
  }
})
