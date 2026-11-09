import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';
import { loadProblems } from './lib/problems.mjs';
import { getChatReply, PublicError } from './lib/chat.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

function json(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(data));
}

async function readJson(request) {
  if (!(request.headers['content-type'] ?? '').startsWith('application/json')) throw new PublicError(415, 'Forespørselen må være JSON.');
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 64000) throw new PublicError(413, 'Meldingen er for stor. Start en ny samtale.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new PublicError(400, 'Forespørselen inneholder ugyldig JSON.'); }
}

export async function createApp({ apiKey = '', model = 'gpt-4o', fetchImpl = fetch, data = undefined } = {}) {
  const dataset = data ?? await loadProblems();
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(request.url, 'http://localhost');
      // Den lokale chatten skal bare kunne brukes fra appens egen side.
      const origin = request.headers.origin;
      if (request.method === 'POST' && origin && ![`http://localhost:${request.socket.localPort}`, `http://127.0.0.1:${request.socket.localPort}`].includes(origin)) {
        throw new PublicError(403, 'Forespørselen må komme fra den lokale prototypen.');
      }
      if (request.method === 'GET' && url.pathname === '/api/problems') {
        return json(response, 200, { ...dataset, aiConfigured: Boolean(apiKey) });
      }
      if (request.method === 'POST' && url.pathname === '/api/chat') {
        const body = await readJson(request);
        const controller = new AbortController();
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        const reply = await getChatReply(body, { problems: dataset.problems, apiKey, model, fetchImpl, signal: controller.signal });
        return json(response, 200, { reply });
      }
      if (url.pathname.startsWith('/api/')) throw new PublicError(404, 'Fant ikke denne funksjonen.');
      if (!['GET', 'HEAD'].includes(request.method)) throw new PublicError(405, 'Denne forespørselen er ikke støttet.');

      let directory = resolve(root, 'public');
      let relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      if (relative.startsWith('/vendor/katex/')) {
        directory = resolve(root, 'node_modules/katex/dist');
        relative = relative.slice('/vendor/katex'.length);
      } else if (relative === '/vendor/markdown-it.js') {
        directory = resolve(root, 'node_modules/markdown-it/dist');
        relative = '/markdown-it.min.js';
      }
      const path = resolve(directory, `.${relative}`);
      if (!path.startsWith(directory + sep) || !mime[extname(path)]) throw new PublicError(404, 'Siden finnes ikke.');
      let contents;
      try { contents = await readFile(path); } catch { throw new PublicError(404, 'Siden finnes ikke.'); }
      response.writeHead(200, { 'Content-Type': mime[extname(path)] });
      response.end(request.method === 'HEAD' ? undefined : contents);
    } catch (error) {
      if (response.destroyed) return;
      const status = error instanceof PublicError ? error.status : 500;
      json(response, status, { error: error instanceof PublicError ? error.message : 'Noe gikk galt i den lokale serveren. Prøv igjen.' });
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (existsSync(resolve(root, '.env'))) loadEnvFile(resolve(root, '.env'));
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('PORT må være et heltall mellom 1 og 65535.\n');
    process.exitCode = 1;
  } else {
    try {
      const server = await createApp({ apiKey: process.env.OPENAI_API_KEY?.trim(), model: process.env.OPENAI_MODEL?.trim() || 'gpt-4o' });
      server.on('error', (error) => {
        process.stderr.write(error.code === 'EADDRINUSE' ? `Port ${port} er i bruk. Velg en annen PORT i .env.\n` : 'Kunne ikke starte den lokale serveren.\n');
        process.exitCode = 1;
      });
      server.listen(port, '127.0.0.1', () => process.stdout.write(`MathMate er klar på http://localhost:${port}\n`));
    } catch {
      process.stderr.write('Kunne ikke lese data/Matematikk_tekstoppgaver_1550.xlsx. Kontroller filen og kolonnene beskrevet i README.md.\n');
      process.exitCode = 1;
    }
  }
}
