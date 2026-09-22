import http from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Map([['/manual.html', ['manual.html', 'text/html']],['/navigation.mjs', ['navigation.mjs', 'text/javascript']],['/calibration.mjs', ['calibration.mjs', 'text/javascript']],['/', ['index.html', 'text/html']], ['/index.html', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/audio.mjs', ['audio.mjs', 'text/javascript']], ['/session.mjs', ['session.mjs', 'text/javascript']], ['/scoring.mjs', ['scoring.mjs', 'text/javascript']]]);
const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  const route = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!route) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const bytes = await readFile(new URL(route[0], import.meta.url));
    res.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'microphone=(self)' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(500); res.end('Unable to load file'); }
});
server.on('error', err => { console.error(err.message); process.exitCode = 1; });
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log('Karaoke lab: http://localhost:4173'));
