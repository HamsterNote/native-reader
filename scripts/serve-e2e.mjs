import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2]);
const canaryRequests = [];
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:8181');
  if (url.pathname === '/__test-csp-observations') {
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    return response.end(JSON.stringify(canaryRequests));
  }
  if (url.pathname.startsWith('/__publication-canary/')) {
    canaryRequests.push({ url: url.pathname, host: request.headers.host });
    response.writeHead(200, {
      'Content-Type':
        types[path.extname(url.pathname)] ?? 'application/octet-stream',
    });
    return response.end('');
  }
  try {
    const file = path.resolve(
      root,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
    );
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Invalid path');
    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}).listen(8181, '0.0.0.0');
