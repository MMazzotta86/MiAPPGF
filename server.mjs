import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const port = Number(process.env.PORT || 3000);
const apiBase = 'https://api.tink.com';
const clientId = process.env.TINK_CLIENT_ID;
const clientSecret = process.env.TINK_CLIENT_SECRET;
const redirectUri = process.env.TINK_REDIRECT_URI || `http://localhost:${port}/tink/callback`;
const market = process.env.TINK_MARKET || 'ES';
const locale = process.env.TINK_LOCALE || 'es_ES';
const externalUserId = process.env.TINK_EXTERNAL_USER_ID || 'fijo-local-user';
const userFile = join(root, '.tink-user.json');
let userAccessToken = null;
let userTokenExpiresAt = 0;

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function configReady() { return Boolean(clientId && clientSecret); }

async function tinkRequest(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body instanceof URLSearchParams ? { 'content-type': 'application/x-www-form-urlencoded' } : body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: body instanceof URLSearchParams ? body : JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = { message: raw }; }
  if (!response.ok) {
    const error = new Error(data?.error_description || data?.message || `Tink respondió ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getClientToken() {
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope: 'user:create authorization:grant' });
  const token = await tinkRequest('/api/v1/oauth/token', { method: 'POST', body: form });
  return token.access_token;
}

async function getOrCreateTinkUser(clientToken) {
  try {
    const saved = JSON.parse(await readFile(userFile, 'utf8'));
    if (saved.externalUserId === externalUserId && saved.userId) return saved.userId;
  } catch { /* First connection: create the user below. */ }

  const user = await tinkRequest('/api/v1/user/create', {
    method: 'POST', token: clientToken,
    body: { externalUserId, market, locale },
  });
  const userId = user.userId || user.id;
  if (!userId) throw new Error('Tink no devolvió el identificador del usuario.');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(userFile, JSON.stringify({ externalUserId, userId, connected: false }, null, 2), { flag: 'w' });
  return userId;
}

async function createGrantCode(clientToken, userId) {
  const form = new URLSearchParams({ user_id: userId, scope: 'accounts:read,transactions:read,credentials:read' });
  const grant = await tinkRequest('/api/v1/oauth/authorization-grant', { method: 'POST', token: clientToken, body: form });
  if (!grant.code) throw new Error('Tink no devolvió un código de autorización.');
  return grant.code;
}

async function exchangeCode(code) {
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code });
  const token = await tinkRequest('/api/v1/oauth/token', { method: 'POST', body: form });
  userAccessToken = token.access_token;
  userTokenExpiresAt = Date.now() + Number(token.expires_in || 7200) * 1000;
}

async function getUserToken() {
  if (userAccessToken && Date.now() < userTokenExpiresAt - 30_000) return userAccessToken;
  if (!existsSync(userFile)) throw new Error('Primero conecta una cuenta bancaria desde la app.');
  const saved = JSON.parse(await readFile(userFile, 'utf8'));
  const clientToken = await getClientToken();
  const code = await createGrantCode(clientToken, saved.userId);
  await exchangeCode(code);
  return userAccessToken;
}

async function handleApi(req, res, url) {
  if (url.pathname === '/api/tink/status' && req.method === 'GET') {
    let connected = false;
    try { connected = JSON.parse(await readFile(userFile, 'utf8')).connected === true; } catch { /* not connected */ }
    return sendJson(res, 200, { configured: configReady(), connected, provider: 'Tink', market });
  }

  if (url.pathname === '/api/tink/connect' && req.method === 'GET') {
    if (!configReady()) return sendJson(res, 503, { error: 'Falta configurar TINK_CLIENT_ID y TINK_CLIENT_SECRET en .env.' });
    try {
      const clientToken = await getClientToken();
      const userId = await getOrCreateTinkUser(clientToken);
      const authorizationCode = await createGrantCode(clientToken, userId);
      const link = new URL('https://link.tink.com/1.0/transactions/connect-accounts');
      link.search = new URLSearchParams({ client_id: clientId, authorization_code: authorizationCode, redirect_uri: redirectUri, market, locale }).toString();
      res.writeHead(302, { location: link.toString(), 'cache-control': 'no-store' });
      return res.end();
    } catch (error) {
      return sendJson(res, error.status || 502, { error: error.message });
    }
  }

  if (url.pathname === '/tink/callback' && req.method === 'GET') {
    const code = url.searchParams.get('code');
    if (url.searchParams.get('error')) {
      res.writeHead(302, { location: `/?bank_error=${encodeURIComponent(url.searchParams.get('error'))}` });
      return res.end();
    }
    if (!code) return sendJson(res, 400, { error: 'Tink no devolvió un código de autorización.' });
    try {
      await exchangeCode(code);
      const saved = JSON.parse(await readFile(userFile, 'utf8'));
      const { writeFile } = await import('node:fs/promises');
      await writeFile(userFile, JSON.stringify({ ...saved, connected: true }, null, 2));
      res.writeHead(302, { location: '/?bank_connected=1' });
      return res.end();
    } catch (error) {
      res.writeHead(302, { location: `/?bank_error=${encodeURIComponent(error.message)}` });
      return res.end();
    }
  }

  if (url.pathname === '/api/tink/transactions' && req.method === 'GET') {
    try {
      const token = await getUserToken();
      const query = new URLSearchParams({ pageSize: '100', statusIn: 'BOOKED' });
      const data = await tinkRequest(`/enrichment/v1/transactions?${query}`, { token });
      return sendJson(res, 200, data);
    } catch (error) {
      return sendJson(res, error.status || 502, { error: error.message });
    }
  }
  return sendJson(res, 404, { error: 'Ruta no encontrada.' });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/tink/')) return handleApi(req, res, url);
  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(root, requestedPath));
  if (!filePath.startsWith(root)) return sendJson(res, 403, { error: 'Acceso denegado.' });
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: 'Archivo no encontrado.' });
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Fijo disponible en http://localhost:${port}`);
});
