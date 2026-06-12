#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const { domainToASCII } = require('node:url');

const API_BASE = 'https://api.cloudflare.com/client/v4';
const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function loadDotEnv(filePath = path.join(process.cwd(), '.env')) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function parseArgs(argv) {
  const options = {
    domainsFile: process.env.DOMAINS_FILE || 'domains.txt',
    token: process.env.CLOUDFLARE_API_TOKEN || '',
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',
    ip: process.env.A_RECORD_IP || '',
    proxied: parseBool(process.env.PROXIED, true),
    ttl: Number(process.env.TTL || 1),
    sslStrict: parseBool(process.env.SSL_STRICT, true),
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value after ${arg}`);
      return argv[i];
    };

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--domains-file' || arg === '--domains' || arg === '-d') options.domainsFile = next();
    else if (arg === '--token') options.token = next();
    else if (arg === '--account-id') options.accountId = next();
    else if (arg === '--ip' || arg === '--a-ip') options.ip = next();
    else if (arg === '--ttl') options.ttl = Number(next());
    else if (arg === '--proxied') options.proxied = parseBool(next(), true);
    else if (arg === '--no-proxy') options.proxied = false;
    else if (arg === '--ssl-strict') options.sslStrict = true;
    else if (arg === '--no-ssl-strict') options.sslStrict = false;
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function printHelp() {
  console.log(`
Cloudflare Bulk Zones

Adds domains to Cloudflare and optionally creates A records for the root domain and wildcard.

Usage:
  node cf_add_zones.js --domains-file domains.txt --ip 203.0.113.10

Required:
  CLOUDFLARE_API_TOKEN   Cloudflare API token
  CLOUDFLARE_ACCOUNT_ID  Cloudflare Account ID

Options:
  -d, --domains-file      Text file with domains. Default: domains.txt
      --token             API token. Can also be set in .env
      --account-id        Account ID. Can also be set in .env
      --ip, --a-ip        Server IPv4 for A records
      --proxied true|false  Cloudflare proxy for A records. Default: true
      --no-proxy          Shortcut for --proxied false
      --ttl               DNS TTL. 1 means Auto. Default: 1
      --no-ssl-strict     Do not set SSL mode to Full (strict)
      --dry-run           Show planned actions without changing Cloudflare
  -h, --help              Show this help

Domain file format:
  example.com
  example.org 203.0.113.20
  # comments are ignored
`);
}

function normalizeDomain(input) {
  let value = String(input || '').trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split(':')[0];
  value = value.replace(/\.$/, '');

  const ascii = domainToASCII(value);
  if (!ascii || ascii.length > 253) return '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(ascii)) return '';
  if (ascii.split('.').some((part) => !part || part.length > 63 || part.startsWith('-') || part.endsWith('-'))) {
    return '';
  }
  return ascii;
}

function isValidIPv4(ip) {
  const parts = String(ip || '').trim().split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const n = Number(part);
    return n >= 0 && n <= 255;
  });
}

function readDomains(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Domains file not found: ${abs}`);
  }

  const domains = [];
  const seen = new Set();
  const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const clean = line.replace(/\s+#.*$/, '').trim();
    if (!clean || clean.startsWith('#')) continue;

    const [domainRaw, ipRaw] = clean.split(/[\s,;]+/);
    const domain = normalizeDomain(domainRaw);
    if (!domain) {
      console.warn(`Warning: skipped invalid domain on line ${lineNumber}: ${domainRaw}`);
      continue;
    }

    if (seen.has(domain)) {
      console.warn(`Warning: skipped duplicate domain on line ${lineNumber}: ${domain}`);
      continue;
    }

    if (ipRaw && !isValidIPv4(ipRaw)) {
      throw new Error(`Invalid IPv4 address on line ${lineNumber}: ${ipRaw}`);
    }

    seen.add(domain);
    domains.push({
      domain,
      ip: ipRaw || '',
    });
  }

  return domains;
}

async function cfRequest(cfg, method, endpoint, body, query) {
  const url = new URL(`${API_BASE}${endpoint}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { success: false, errors: [{ message: text || response.statusText }] };
  }

  if (!response.ok || !data || data.success === false) {
    const error = new Error(formatCloudflareError(response.status, data));
    error.status = response.status;
    throw error;
  }

  return data.result;
}

function formatCloudflareError(status, data) {
  const errors = data && Array.isArray(data.errors) ? data.errors : [];
  const messages = errors.map((error) => error.message || JSON.stringify(error)).filter(Boolean);
  return `Cloudflare API error ${status}: ${messages.join('; ') || 'Unknown error'}`;
}

async function retry(fn, retries = 3) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!TRANSIENT_STATUSES.has(Number(error.status)) || attempt === retries) break;
      await sleep(700 * 2 ** attempt);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getZoneByName(cfg, domain) {
  const zones = await retry(() => cfRequest(cfg, 'GET', '/zones', null, {
    name: domain,
    'account.id': cfg.accountId,
    per_page: 1,
  }));
  return Array.isArray(zones) ? zones[0] || null : null;
}

async function createZone(cfg, domain) {
  return retry(() => cfRequest(cfg, 'POST', '/zones', {
    name: domain,
    account: { id: cfg.accountId },
    type: 'full',
  }));
}

async function getZoneDetails(cfg, zoneId) {
  return retry(() => cfRequest(cfg, 'GET', `/zones/${zoneId}`));
}

async function setSslStrict(cfg, zoneId) {
  return retry(() => cfRequest(cfg, 'PATCH', `/zones/${zoneId}/settings/ssl`, { value: 'strict' }));
}

async function listARecords(cfg, zoneId, name) {
  return retry(() => cfRequest(cfg, 'GET', `/zones/${zoneId}/dns_records`, null, {
    type: 'A',
    name,
    per_page: 100,
  }));
}

async function createARecord(cfg, zoneId, name, ip) {
  return retry(() => cfRequest(cfg, 'POST', `/zones/${zoneId}/dns_records`, {
    type: 'A',
    name,
    content: ip,
    proxied: cfg.proxied,
    ttl: cfg.ttl,
  }));
}

async function updateARecord(cfg, zoneId, record, ip) {
  return retry(() => cfRequest(cfg, 'PUT', `/zones/${zoneId}/dns_records/${record.id}`, {
    type: 'A',
    name: record.name,
    content: ip,
    proxied: cfg.proxied,
    ttl: cfg.ttl,
  }));
}

async function deleteDnsRecord(cfg, zoneId, recordId) {
  return retry(() => cfRequest(cfg, 'DELETE', `/zones/${zoneId}/dns_records/${recordId}`));
}

async function ensureARecords(cfg, zoneId, domain, ip) {
  for (const name of [domain, `*.${domain}`]) {
    const records = await listARecords(cfg, zoneId, name);
    const existingRecords = Array.isArray(records) ? records : [];

    if (!existingRecords.length) {
      await createARecord(cfg, zoneId, name, ip);
      console.log(`  DNS: created A ${name} -> ${ip}`);
      continue;
    }

    const isDesired = (record) =>
      record.content === ip &&
      Boolean(record.proxied) === Boolean(cfg.proxied) &&
      Number(record.ttl) === Number(cfg.ttl);

    const existing = existingRecords.find(isDesired) || existingRecords[0];
    const extraRecords = existingRecords.filter((record) => record.id !== existing.id);
    for (const record of extraRecords) {
      await deleteDnsRecord(cfg, zoneId, record.id);
      console.log(`  DNS: removed extra A ${name} (${record.content})`);
    }

    const needsUpdate =
      existing.content !== ip ||
      Boolean(existing.proxied) !== Boolean(cfg.proxied) ||
      Number(existing.ttl) !== Number(cfg.ttl);

    if (needsUpdate) {
      await updateARecord(cfg, zoneId, existing, ip);
      console.log(`  DNS: updated A ${name} -> ${ip}`);
    } else {
      console.log(`  DNS: already OK ${name} -> ${ip}`);
    }
  }
}

async function processDomain(cfg, item) {
  const ip = item.ip || cfg.ip;
  console.log(`\n${item.domain}`);

  if (cfg.dryRun) {
    console.log('  dry-run: would create or reuse Cloudflare zone');
    if (cfg.sslStrict) console.log('  dry-run: would set SSL mode to Full (strict)');
    if (ip) console.log(`  dry-run: would create/update A records for ${item.domain} and *.${item.domain} -> ${ip}`);
    return { domain: item.domain, ok: true, dryRun: true, nameServers: [] };
  }

  let zone = await getZoneByName(cfg, item.domain);
  if (zone) {
    console.log(`  zone: already exists (${zone.id})`);
  } else {
    zone = await createZone(cfg, item.domain);
    console.log(`  zone: created (${zone.id})`);
  }

  if (cfg.sslStrict) {
    await setSslStrict(cfg, zone.id);
    console.log('  SSL: Full (strict)');
  }

  if (ip) {
    await ensureARecords(cfg, zone.id, item.domain, ip);
  } else {
    console.log('  DNS: skipped, no IP provided');
  }

  const details = zone.name_servers && zone.name_servers.length ? zone : await getZoneDetails(cfg, zone.id);
  const nameServers = details.name_servers || [];
  if (nameServers.length) console.log(`  NS: ${nameServers.join(', ')}`);

  return { domain: item.domain, ok: true, nameServers };
}

function writeNameserversCsv(results) {
  const rows = ['domain,nameserver_1,nameserver_2'];
  for (const item of results) {
    if (!item.ok || !item.nameServers || item.nameServers.length === 0) continue;
    rows.push([item.domain, item.nameServers[0] || '', item.nameServers[1] || ''].join(','));
  }

  if (rows.length === 1) return '';

  const filePath = path.resolve('nameservers.csv');
  fs.writeFileSync(filePath, `${rows.join('\n')}\n`, 'utf8');
  return filePath;
}

async function main() {
  loadDotEnv(path.join(__dirname, '.env'));
  loadDotEnv(path.join(process.cwd(), '.env'));

  const cfg = parseArgs(process.argv.slice(2));
  if (cfg.help) {
    printHelp();
    return;
  }

  if (!cfg.dryRun) {
    if (!cfg.token) throw new Error('Set CLOUDFLARE_API_TOKEN in .env or pass --token');
    if (!cfg.accountId) throw new Error('Set CLOUDFLARE_ACCOUNT_ID in .env or pass --account-id');
  }

  if (cfg.ip && !isValidIPv4(cfg.ip)) throw new Error(`Invalid IPv4 address: ${cfg.ip}`);
  if (!Number.isFinite(cfg.ttl) || cfg.ttl < 1) throw new Error('TTL must be a positive number. Use 1 for Auto.');

  const domains = readDomains(cfg.domainsFile);
  if (!domains.length) throw new Error(`No valid domains found in ${cfg.domainsFile}`);

  console.log(`Found domains: ${domains.length}`);
  console.log(`A records: ${cfg.ip ? cfg.ip : 'only when IP is written near a domain'}`);
  console.log(`Proxy: ${cfg.proxied ? 'on' : 'off'}`);
  console.log(`SSL strict: ${cfg.sslStrict ? 'on' : 'off'}`);

  const results = [];
  for (const item of domains) {
    try {
      // Sequential processing is easier to read and friendlier to API limits.
      // eslint-disable-next-line no-await-in-loop
      results.push(await processDomain(cfg, item));
    } catch (error) {
      console.log(`  ERROR: ${error.message || error}`);
      results.push({ domain: item.domain, ok: false, error: error.message || String(error), nameServers: [] });
    }
  }

  const okCount = results.filter((item) => item.ok).length;
  const failed = results.length - okCount;
  const nsFile = cfg.dryRun ? '' : writeNameserversCsv(results);

  console.log('\nDone');
  console.log(`Success: ${okCount}`);
  console.log(`Failed: ${failed}`);
  if (nsFile) console.log(`Nameservers saved to: ${nsFile}`);

  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
