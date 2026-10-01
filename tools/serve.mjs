// Dev-only static server for local testing. Serves ./site on http://127.0.0.1:8000 and applies
// the same headers as site/_headers, so the CSP and other headers can be tested locally.
// Uses only Node built-ins. Nothing in tools/ is deployed or shipped to the browser.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/** Parse Netlify/Cloudflare-style _headers: a path pattern line, then indented "Name: value" lines. */
function loadHeaders() {
  const rules = [];
  let current = null;
  for (const line of readFileSync(join(ROOT, '_headers'), 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = { pattern: line.trim(), headers: [] }; rules.push(current); continue; }
    const i = line.indexOf(':');
    if (current && i > 0) current.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return rules;
}

function matches(pattern, path) {
  const re = new RegExp('^' + pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(path);
}

const rules = loadHeaders();

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  for (const rule of rules) if (matches(rule.pattern, url.pathname)) for (const [k, v] of rule.headers) res.setHeader(k, v);
  if (!file.startsWith(ROOT + sep) || path.includes('_headers')) { res.writeHead(404).end('Not found'); return; }
  try {
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
    console.log(`200 ${req.method} ${url.pathname}`);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    console.log(`404 ${req.method} ${url.pathname}`);
  }
}).listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT} at http://${HOST}:${PORT}/ with headers from site/_headers`);
});
