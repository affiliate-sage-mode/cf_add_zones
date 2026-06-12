#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 5173);

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function pushArg(args, name, value) {
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    args.push(name, String(value).trim());
  }
}

function runScript(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['cf_add_zones.js', ...args], {
      cwd: __dirname,
      env: { ...process.env, ...env },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function handleRun(req, res) {
  let tempDir = '';

  try {
    const body = JSON.parse(await readBody(req) || '{}');
    const domains = String(body.domains || '').trim();
    if (!domains) return sendJson(res, 400, { ok: false, error: 'Додайте хоча б один домен.' });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-zones-'));
    const domainsFile = path.join(tempDir, 'domains.txt');
    fs.writeFileSync(domainsFile, domains, 'utf8');

    const args = ['--domains-file', domainsFile];
    pushArg(args, '--ip', body.ip);
    pushArg(args, '--ttl', body.ttl || '1');
    args.push('--proxied', body.proxied === 'false' ? 'false' : 'true');
    if (body.sslStrict === 'false') args.push('--no-ssl-strict');
    if (body.dryRun === 'true') args.push('--dry-run');

    const env = {};
    if (body.token) env.CLOUDFLARE_API_TOKEN = String(body.token).trim();
    if (body.accountId) env.CLOUDFLARE_ACCOUNT_ID = String(body.accountId).trim();

    const result = await runScript(args, env);
    return sendJson(res, 200, {
      ok: result.code === 0,
      code: result.code,
      output: result.stdout,
      error: result.stderr,
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message || String(error) });
  } finally {
    if (tempDir) fs.rm(tempDir, { recursive: true, force: true }, () => {});
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    sendFile(res, path.join(__dirname, 'index.html'), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && req.url === '/run') {
    handleRun(req, res);
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.on('error', (error) => {
  console.error(error.message || error);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Local UI: http://${HOST}:${PORT}`);
});
