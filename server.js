import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sirv from 'sirv';

const PORT = Number(process.env.PORT) || 80;
const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'vakt.db');
const db = new DatabaseSync(DB_PATH);

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS monitors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    group_name TEXT NOT NULL DEFAULT 'Harkco Suite',
    expected_status INTEGER NOT NULL DEFAULT 200,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS probe_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    monitor_id TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    latency_ms REAL NOT NULL,
    is_up INTEGER NOT NULL,
    response_body TEXT,
    checked_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL,
    monitor_name TEXT NOT NULL,
    url TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    error_message TEXT NOT NULL,
    error_payload TEXT,
    started_at TEXT NOT NULL,
    resolved_at TEXT,
    duration_sec REAL
  );
`);

// Seed default Harkco fleet if empty
const countRow = db.prepare('SELECT count(*) as count FROM monitors').get();
if (!countRow || countRow.count === 0) {
  const insertStmt = db.prepare(`
    INSERT INTO monitors (id, name, url, group_name, expected_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const DEFAULT_FLEET = [
    { id: 'qvitt', name: 'Qvitt', url: 'https://qvitt.se/' },
    { id: 'fakturacraft', name: 'FakturaCraft', url: 'https://fakturacraft.apps.harkco.se/health' },
    { id: 'skattekoll', name: 'SkatteKoll', url: 'https://skattekoll.apps.harkco.se/health' },
    { id: 'moteskoll', name: 'MötesKoll', url: 'https://moteskoll.apps.harkco.se/health' },
    { id: 'brygg', name: 'Bryggkompis', url: 'https://brygg.apps.harkco.se/health' },
    { id: 'styrka', name: 'Styrka', url: 'https://styrka.apps.harkco.se/health' },
    { id: 'akvarium', name: 'Akvarium', url: 'https://akvarium.apps.harkco.se/health' },
    { id: 'puls', name: 'Puls', url: 'https://puls.apps.harkco.se/health' },
    { id: 'knippa', name: 'Knippa', url: 'https://knippa.apps.harkco.se/health' },
    { id: 'knatte', name: 'Knattepatrullen', url: 'https://knatte.apps.harkco.se/' },
    { id: 'timecapsule', name: 'Time Capsule', url: 'https://time-capsule.apps.harkco.se/' },
  ];

  const now = new Date().toISOString();
  for (const m of DEFAULT_FLEET) {
    insertStmt.run(m.id, m.name, m.url, 'Harkco Suite', 200, now);
  }
  console.log(`[Vakt] Seeded ${DEFAULT_FLEET.length} Harkco Daily App monitors.`);
}

// Migrate/correct any existing monitors
db.prepare("UPDATE monitors SET url = 'https://qvitt.se/' WHERE id = 'qvitt' AND url = 'https://qvitt.se/health'").run();
db.prepare("UPDATE monitors SET url = 'https://time-capsule.apps.harkco.se/' WHERE id = 'timecapsule' AND url = 'https://time-capsule.apps.harkco.se/health'").run();

// Prepared statements
const stmtGetMonitors = db.prepare('SELECT * FROM monitors ORDER BY group_name DESC, name ASC');
const stmtInsertProbe = db.prepare(`
  INSERT INTO probe_history (monitor_id, status_code, latency_ms, is_up, response_body, checked_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtGetHistory = db.prepare(`
  SELECT status_code, latency_ms, is_up, response_body, checked_at
  FROM probe_history
  WHERE monitor_id = ?
  ORDER BY id DESC
  LIMIT 20
`);
const stmtGetOpenIncident = db.prepare(`
  SELECT * FROM incidents WHERE monitor_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1
`);
const stmtInsertIncident = db.prepare(`
  INSERT INTO incidents (id, monitor_id, monitor_name, url, status_code, error_message, error_payload, started_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const stmtResolveIncident = db.prepare(`
  UPDATE incidents
  SET resolved_at = ?, duration_sec = ?
  WHERE id = ?
`);
const stmtGetRecentIncidents = db.prepare('SELECT * FROM incidents ORDER BY started_at DESC LIMIT 15');
const stmtInsertMonitor = db.prepare(`
  INSERT INTO monitors (id, name, url, group_name, expected_status, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtDeleteMonitor = db.prepare('DELETE FROM monitors WHERE id = ?');
const stmtDeleteMonitorHistory = db.prepare('DELETE FROM probe_history WHERE monitor_id = ?');

// Core Probing Function
async function probeSingleMonitor(monitor) {
  const start = performance.now();
  const checkedAt = new Date().toISOString();
  let statusCode = 0;
  let latencyMs = 0;
  let isUp = false;
  let responseBody = '';
  let errorMsg = '';

  try {
    const res = await fetch(monitor.url, {
      signal: AbortSignal.timeout(4500),
      headers: {
        'User-Agent': 'Harkco-Vakt-Uptime/1.0',
        'Accept': 'application/json, text/html, */*',
      },
    });

    latencyMs = Math.round(performance.now() - start);
    statusCode = res.status;
    isUp = (statusCode === monitor.expected_status || (statusCode >= 200 && statusCode < 300));

    try {
      const text = await res.text();
      responseBody = text.slice(0, 16384); // Up to 16KB
    } catch (e) {
      responseBody = '';
    }

    if (!isUp) {
      errorMsg = `HTTP Status ${statusCode} received (expected ${monitor.expected_status})`;
    }
  } catch (err) {
    latencyMs = Math.round(performance.now() - start);
    statusCode = 0;
    isUp = false;
    errorMsg = err.name === 'TimeoutError' ? 'Connection timed out (>4500ms)' : (err.message || 'Network unreachable');
    responseBody = JSON.stringify({ error: errorMsg, code: err.code || 'ERR_CONNECTION' });
  }

  // Insert into history
  stmtInsertProbe.run(monitor.id, statusCode, latencyMs, isUp ? 1 : 0, responseBody, checkedAt);

  // Manage Incidents
  const openIncident = stmtGetOpenIncident.get(monitor.id);
  if (!isUp) {
    if (!openIncident) {
      const incidentId = `inc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      stmtInsertIncident.run(
        incidentId,
        monitor.id,
        monitor.name,
        monitor.url,
        statusCode,
        errorMsg,
        responseBody,
        checkedAt
      );
      console.warn(`[Vakt] INCIDENT DETECTED: ${monitor.name} (${monitor.url}) -> ${errorMsg}`);
    }
  } else {
    if (openIncident) {
      const durationSec = Math.max(1, Math.round((new Date(checkedAt).getTime() - new Date(openIncident.started_at).getTime()) / 1000));
      stmtResolveIncident.run(checkedAt, durationSec, openIncident.id);
      console.log(`[Vakt] INCIDENT RESOLVED: ${monitor.name} recovered after ${durationSec}s`);
    }
  }

  return {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    statusCode,
    latencyMs,
    isUp,
    checkedAt,
  };
}

async function probeAllMonitors() {
  const monitors = stmtGetMonitors.all();
  const promises = monitors.map((m) => probeSingleMonitor(m));
  return Promise.all(promises);
}

// Background probing scheduler: Every 45 seconds
setInterval(() => {
  probeAllMonitors().catch((err) => console.error('[Vakt Scheduler Error]:', err));
}, 45000);

// Initial probe on startup after 2 seconds
setTimeout(() => {
  probeAllMonitors().catch(() => {});
}, 2000);

// Static assets handler
const assets = sirv(path.resolve('dist'), {
  single: true,
  dev: true,
  gzip: true,
  brotli: true,
});

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 512 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /health
  if (req.method === 'GET' && pathname === '/health') {
    const monitors = stmtGetMonitors.all();
    const openIncidents = db.prepare('SELECT count(*) as count FROM incidents WHERE resolved_at IS NULL').get();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      app: 'Vakt',
      version: '1.0.0',
      active_monitors: monitors.length,
      open_incidents: openIncidents?.count || 0,
      fleet_status: (openIncidents?.count || 0) === 0 ? 'all_operational' : 'degraded',
      service: 'vakt',
    }));
    return;
  }

  // GET /api/monitors
  if (req.method === 'GET' && pathname === '/api/monitors') {
    const monitors = stmtGetMonitors.all();
    const detailed = monitors.map((m) => {
      const historyDesc = stmtGetHistory.all(m.id);
      const history = historyDesc.reverse(); // chronological order
      const latest = history[history.length - 1];

      let upCount = 0;
      let totalLatency = 0;
      history.forEach((h) => {
        if (h.is_up) upCount++;
        totalLatency += h.latency_ms;
      });

      const uptime24h = history.length > 0 ? Math.round((upCount / history.length) * 1000) / 10 : 100;
      const avgLatency = history.length > 0 ? Math.round(totalLatency / history.length) : 0;

      let currentStatus = 'up';
      if (latest) {
        if (!latest.is_up) currentStatus = 'down';
        else if (latest.latency_ms > 450) currentStatus = 'degraded';
      }

      return {
        id: m.id,
        name: m.name,
        url: m.url,
        group: m.group_name,
        expectedStatus: m.expected_status,
        currentStatus,
        lastLatencyMs: latest?.latency_ms || 0,
        uptime24h,
        history,
        lastCheckedAt: latest?.checked_at || m.created_at,
        lastResponseBody: latest?.response_body || null,
      };
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(detailed));
    return;
  }

  // POST /api/probe-now
  if (req.method === 'POST' && pathname === '/api/probe-now') {
    try {
      const results = await probeAllMonitors();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', probedCount: results.length, results }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/incidents
  if (req.method === 'GET' && pathname === '/api/incidents') {
    const rawIncidents = stmtGetRecentIncidents.all();
    const formatted = rawIncidents.map((inc) => ({
      id: inc.id,
      monitorId: inc.monitor_id,
      monitorName: inc.monitor_name,
      url: inc.url,
      statusCode: inc.status_code,
      errorMessage: inc.error_message,
      errorPayload: inc.error_payload,
      startedAt: inc.started_at,
      resolvedAt: inc.resolved_at,
      durationSec: inc.duration_sec,
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(formatted));
    return;
  }

  // POST /api/monitors (Add custom endpoint)
  if (req.method === 'POST' && pathname === '/api/monitors') {
    try {
      const body = await readJsonBody(req);
      if (!body.url || !body.name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Name and valid URL are required' }));
        return;
      }

      const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date().toISOString();
      stmtInsertMonitor.run(id, body.name.trim(), body.url.trim(), 'Custom', 200, now);

      // Probe immediately
      const probeRes = await probeSingleMonitor({
        id,
        name: body.name.trim(),
        url: body.url.trim(),
        expected_status: 200,
      });

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'created', id, probeRes }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // DELETE /api/monitors/:id
  if (req.method === 'DELETE' && pathname.startsWith('/api/monitors/')) {
    const id = pathname.replace('/api/monitors/', '');
    stmtDeleteMonitor.run(id);
    stmtDeleteMonitorHistory.run(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'deleted', id }));
    return;
  }

  // Fallback to static client assets
  assets(req, res, () => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Vakt] Sentinel server running on http://0.0.0.0:${PORT}`);
});
