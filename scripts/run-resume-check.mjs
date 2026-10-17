import { createServer } from 'vite'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})
try {
  await server.ssrLoadModule('/src/session/resume.selfcheck.ts')
} finally {
  await server.close()
}
