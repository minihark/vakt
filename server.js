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

  CREATE TABLE IF NOT EXISTS alert_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alert_logs (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    monitor_name TEXT NOT NULL,
    channel TEXT NOT NULL,
    status TEXT NOT NULL,
    details TEXT,
    dispatched_at TEXT NOT NULL
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

// Alerting Prepared Statements
const stmtGetAllSettings = db.prepare('SELECT key, value FROM alert_settings');
const stmtSetSetting = db.prepare(`
  INSERT INTO alert_settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const stmtInsertAlertLog = db.prepare(`
  INSERT INTO alert_logs (id, event, monitor_name, channel, status, details, dispatched_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const stmtGetRecentAlertLogs = db.prepare('SELECT * FROM alert_logs ORDER BY dispatched_at DESC LIMIT 25');

function getAlertSettings() {
  const rows = stmtGetAllSettings.all();
  const map = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return {
    webhookUrl: map.webhook_url || process.env.VAKT_WEBHOOK_URL || '',
    alertEmail: map.alert_email || process.env.VAKT_ALERT_EMAIL || 'viktor@harkco.se',
    resendApiKey: map.resend_api_key || process.env.RESEND_API_KEY || '',
    notifyOnDown: map.notify_on_down !== 'false',
    notifyOnRecovery: map.notify_on_recovery !== 'false',
  };
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildAlertHtml({ event, monitorName, url, statusCode, errorMsg, errorPayload, durationSec, latencyMs, timestamp }) {
  const isDown = event === 'incident_opened';
  const isResolved = event === 'incident_resolved';
  const badgeColor = isDown ? '#EF4444' : (isResolved ? '#10B981' : '#3B82F6');
  const badgeText = isDown ? 'INCIDENT DETECTED' : (isResolved ? 'SERVICE RECOVERED' : 'TEST ALERT');
  const title = isDown
    ? `${monitorName} is DOWN (HTTP ${statusCode})`
    : (isResolved ? `${monitorName} is back UP` : `Vakt Test Alert: All Systems Operational`);

  let detailsBlock = '';
  if (isDown) {
    detailsBlock = `
      <div style="margin-top: 16px; padding: 12px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px;">
        <div style="font-size: 12px; color: #8b949e; text-transform: uppercase; font-family: monospace;">Error Details</div>
        <div style="color: #f85149; font-weight: 600; margin-top: 4px; font-family: monospace;">${escapeHtml(errorMsg || 'HTTP check failed')}</div>
        ${errorPayload ? `
          <div style="margin-top: 8px; font-size: 11px; color: #8b949e;">Response Body (JSON):</div>
          <pre style="margin-top: 4px; padding: 8px; background: #161b22; border-radius: 4px; color: #c9d1d9; font-size: 11px; overflow-x: auto; white-space: pre-wrap; font-family: monospace;">${escapeHtml(errorPayload.slice(0, 1000))}</pre>
        ` : ''}
      </div>
    `;
  } else if (isResolved) {
    detailsBlock = `
      <div style="margin-top: 16px; padding: 12px; background: #042617; border: 1px solid #10B981; border-radius: 6px;">
        <div style="font-size: 12px; color: #6ee7b7; font-family: monospace;">RECOVERY TIME</div>
        <div style="color: #ffffff; font-size: 20px; font-weight: bold; margin-top: 2px;">${durationSec || 0} seconds</div>
        <div style="color: #a7f3d0; font-size: 12px; margin-top: 4px;">Service returned HTTP 200 OK (${latencyMs || 0}ms latency).</div>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0c1017; color: #f0f6fc; padding: 24px; margin: 0;">
      <div style="max-width: 580px; margin: 0 auto; background: #161b22; border: 1px solid #30363d; border-radius: 12px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <div style="padding: 20px 24px; border-bottom: 1px solid #21262d; display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 18px; font-weight: bold; letter-spacing: -0.02em; color: #f0f6fc;">
            🛡️ <span style="color: #10B981;">Harkco</span> Vakt
          </div>
          <div style="display: inline-block; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; background: ${badgeColor}22; color: ${badgeColor}; border: 1px solid ${badgeColor}44; text-transform: uppercase;">
            ${badgeText}
          </div>
        </div>
        <div style="padding: 24px;">
          <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #ffffff;">${title}</h2>
          <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 12px;">
            <tr>
              <td style="padding: 6px 0; color: #8b949e; width: 100px;">Endpoint:</td>
              <td style="padding: 6px 0; color: #58a6ff; font-family: monospace;">
                <a href="${url}" style="color: #58a6ff; text-decoration: none;">${url}</a>
              </td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #8b949e;">Status:</td>
              <td style="padding: 6px 0; font-family: monospace; font-weight: bold; color: ${isDown ? '#f85149' : '#10B981'};">
                HTTP ${statusCode || 200}
              </td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #8b949e;">Latency:</td>
              <td style="padding: 6px 0; color: #c9d1d9; font-family: monospace;">${latencyMs || 0} ms</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #8b949e;">Timestamp:</td>
              <td style="padding: 6px 0; color: #8b949e; font-family: monospace;">${timestamp}</td>
            </tr>
          </table>
          ${detailsBlock}
          <div style="margin-top: 24px; text-align: center;">
            <a href="https://vakt.apps.harkco.se" style="display: inline-block; background: #10B981; color: #0c1017; font-weight: 700; font-size: 13px; padding: 10px 20px; border-radius: 6px; text-decoration: none;">
              Open Vakt Fleet Dashboard &rarr;
            </a>
          </div>
        </div>
        <div style="padding: 12px 24px; background: #0d1117; border-top: 1px solid #21262d; font-size: 11px; color: #8b949e; text-align: center;">
          Sent by Harkco Vakt Fleet Sentinel • Zero Ads • Autonomous Alerting
        </div>
      </div>
    </body>
    </html>
  `;
}

async function dispatchAlert(event, data) {
  const settings = getAlertSettings();
  const timestamp = new Date().toISOString();
  const results = [];

  if (event === 'incident_opened' && !settings.notifyOnDown) return results;
  if (event === 'incident_resolved' && !settings.notifyOnRecovery) return results;

  const monitorName = data.monitor?.name || data.monitorName || 'Harkco Service';
  const monitorUrl = data.monitor?.url || data.url || 'https://vakt.apps.harkco.se';
  const statusCode = data.statusCode || (event === 'incident_resolved' ? 200 : 500);

  const payload = {
    service: 'Vakt',
    event,
    monitor: {
      id: data.monitor?.id || 'fleet',
      name: monitorName,
      url: monitorUrl,
    },
    incident: {
      statusCode,
      errorMessage: data.errorMsg || '',
      errorPayload: data.errorPayload || null,
      durationSec: data.durationSec || null,
      latencyMs: data.latencyMs || 0,
    },
    timestamp,
  };

  // 1. Dispatch Webhook
  if (settings.webhookUrl && (settings.webhookUrl.startsWith('http://') || settings.webhookUrl.startsWith('https://'))) {
    try {
      const res = await fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Harkco-Vakt-Alerts/1.0',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const statusText = res.ok ? 'delivered' : `failed (${res.status})`;
      stmtInsertAlertLog.run(logId, event, monitorName, 'webhook', statusText, `Status ${res.status}`, timestamp);
      results.push({ channel: 'webhook', status: statusText });
      console.log(`[Vakt Alert] Webhook dispatched -> ${statusText}`);
    } catch (err) {
      console.error('[Vakt Alert] Webhook error:', err.message);
      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      stmtInsertAlertLog.run(logId, event, monitorName, 'webhook', 'error', err.message, timestamp);
      results.push({ channel: 'webhook', status: 'error', error: err.message });
    }
  }

  // 2. Dispatch Email via Resend API
  const resendKey = settings.resendApiKey || process.env.RESEND_API_KEY;
  if (resendKey && settings.alertEmail) {
    try {
      const subject = event === 'incident_opened'
        ? `🚨 [Vakt] Incident: ${monitorName} returned HTTP ${statusCode}`
        : (event === 'incident_resolved'
          ? `✅ [Vakt] Resolved: ${monitorName} recovered in ${data.durationSec || 0}s`
          : `🛡️ [Vakt] Test Alert: Harkco Sentinel is Active`);

      const html = buildAlertHtml({
        event,
        monitorName,
        url: monitorUrl,
        statusCode,
        errorMsg: data.errorMsg,
        errorPayload: data.errorPayload,
        durationSec: data.durationSec,
        latencyMs: data.latencyMs,
        timestamp,
      });

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Vakt Sentinel <alerts@apps.harkco.se>',
          to: [settings.alertEmail],
          subject,
          html,
        }),
        signal: AbortSignal.timeout(6000),
      });

      const resJson = await res.json().catch(() => ({}));
      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const statusText = res.ok ? 'delivered' : `failed (${res.status})`;
      stmtInsertAlertLog.run(logId, event, monitorName, 'email', statusText, JSON.stringify(resJson), timestamp);
      results.push({ channel: 'email', status: statusText });
      console.log(`[Vakt Alert] Resend email sent to ${settings.alertEmail} -> ${statusText}`);
    } catch (err) {
      console.error('[Vakt Alert] Resend email error:', err.message);
      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      stmtInsertAlertLog.run(logId, event, monitorName, 'email', 'error', err.message, timestamp);
      results.push({ channel: 'email', status: 'error', error: err.message });
    }
  }

  return results;
}

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
      dispatchAlert('incident_opened', {
        monitor,
        statusCode,
        errorMsg,
        errorPayload: responseBody,
        latencyMs,
      }).catch((e) => console.error('[Vakt Alert Dispatch Failed]:', e));
    }
  } else {
    if (openIncident) {
      const durationSec = Math.max(1, Math.round((new Date(checkedAt).getTime() - new Date(openIncident.started_at).getTime()) / 1000));
      stmtResolveIncident.run(checkedAt, durationSec, openIncident.id);
      console.log(`[Vakt] INCIDENT RESOLVED: ${monitor.name} recovered after ${durationSec}s`);
      dispatchAlert('incident_resolved', {
        monitor,
        statusCode: 200,
        latencyMs,
        durationSec,
      }).catch((e) => console.error('[Vakt Alert Dispatch Failed]:', e));
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

  // GET /api/settings
  if (req.method === 'GET' && pathname === '/api/settings') {
    const s = getAlertSettings();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      webhookUrl: s.webhookUrl,
      alertEmail: s.alertEmail,
      resendApiKeyConfigured: Boolean(s.resendApiKey),
      notifyOnDown: s.notifyOnDown,
      notifyOnRecovery: s.notifyOnRecovery,
    }));
    return;
  }

  // POST /api/settings
  if (req.method === 'POST' && pathname === '/api/settings') {
    try {
      const body = await readJsonBody(req);
      if (typeof body.webhookUrl === 'string') {
        stmtSetSetting.run('webhook_url', body.webhookUrl.trim());
      }
      if (typeof body.alertEmail === 'string') {
        stmtSetSetting.run('alert_email', body.alertEmail.trim());
      }
      if (typeof body.resendApiKey === 'string' && body.resendApiKey.trim()) {
        stmtSetSetting.run('resend_api_key', body.resendApiKey.trim());
      }
      if (typeof body.notifyOnDown === 'boolean') {
        stmtSetSetting.run('notify_on_down', body.notifyOnDown ? 'true' : 'false');
      }
      if (typeof body.notifyOnRecovery === 'boolean') {
        stmtSetSetting.run('notify_on_recovery', body.notifyOnRecovery ? 'true' : 'false');
      }

      const updated = getAlertSettings();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        settings: {
          webhookUrl: updated.webhookUrl,
          alertEmail: updated.alertEmail,
          resendApiKeyConfigured: Boolean(updated.resendApiKey),
          notifyOnDown: updated.notifyOnDown,
          notifyOnRecovery: updated.notifyOnRecovery,
        },
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/alerts/test
  if (req.method === 'POST' && pathname === '/api/alerts/test') {
    try {
      const results = await dispatchAlert('test', {
        monitorName: 'Harkco Suite Test',
        url: 'https://vakt.apps.harkco.se',
        statusCode: 200,
        latencyMs: 18,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', results }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/alerts/logs
  if (req.method === 'GET' && pathname === '/api/alerts/logs') {
    const rawLogs = stmtGetRecentAlertLogs.all();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(rawLogs));
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
