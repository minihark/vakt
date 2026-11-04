import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sirv from 'sirv';
import { renderSvgBadge } from './badge-generator.js';

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

// Database migrations for Two-Way ACK and Silent Snooze
try { db.prepare('ALTER TABLE incidents ADD COLUMN acknowledged_at TEXT').run(); } catch {}
try { db.prepare('ALTER TABLE incidents ADD COLUMN acknowledged_by TEXT').run(); } catch {}
try { db.prepare('ALTER TABLE monitors ADD COLUMN acknowledged_at TEXT').run(); } catch {}
try { db.prepare('ALTER TABLE monitors ADD COLUMN snoozed_until TEXT').run(); } catch {}

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
    { id: 'hub', name: 'Harkco Hub', url: 'https://hub.apps.harkco.se/health' },
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
db.prepare("INSERT OR IGNORE INTO monitors (id, name, url, group_name, expected_status, created_at) VALUES ('hub', 'Harkco Hub', 'https://hub.apps.harkco.se/health', 'Harkco Suite', 200, ?)").run(new Date().toISOString());

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
const stmtGetMonitorById = db.prepare('SELECT * FROM monitors WHERE id = ?');

// Two-Way ACK & Silent Snooze Statements
const stmtAckIncident = db.prepare(`
  UPDATE incidents
  SET acknowledged_at = ?, acknowledged_by = ?
  WHERE monitor_id = ? AND resolved_at IS NULL
`);
const stmtAckMonitor = db.prepare(`
  UPDATE monitors
  SET acknowledged_at = ?
  WHERE id = ?
`);
const stmtSnoozeMonitor = db.prepare(`
  UPDATE monitors
  SET snoozed_until = ?
  WHERE id = ?
`);
const stmtUnsnoozeMonitor = db.prepare(`
  UPDATE monitors
  SET snoozed_until = NULL, acknowledged_at = NULL
  WHERE id = ?
`);

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

// Self-Healing Tracking State
const consecutiveFailuresMap = new Map(); // monitorId -> consecutive failure count
const lastHealingAttemptMap = new Map();  // monitorId -> timestamp ms of last action hook trigger
const HEALING_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes loop protection

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
    telegramBotToken: map.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || '8917459869:AAHkiYclgnCJoOjBJ2n65bTOGICcnSpwG3o',
    telegramChatId: map.telegram_chat_id || process.env.TELEGRAM_CHAT_ID || '7684080020',
    notifyTelegram: map.notify_telegram !== 'false',
    notifyOnDown: map.notify_on_down !== 'false',
    notifyOnRecovery: map.notify_on_recovery !== 'false',
    actionHookUrl: map.action_hook_url || process.env.VAKT_ACTION_HOOK_URL || '',
    selfHealingThreshold: parseInt(map.self_healing_threshold, 10) || 3,
    enableSelfHealing: map.enable_self_healing === 'true',
    morningDigestEnabled: map.morning_digest_enabled !== 'false',
    morningDigestHour: parseInt(map.morning_digest_hour, 10) || 8,
    lastDailyDigestDate: map.last_daily_digest_date || '',
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

  if (event === 'incident_opened') {
    if (!settings.notifyOnDown) return results;

    const monitorId = data.monitor?.id || data.monitorId;
    if (monitorId) {
      const monRow = stmtGetMonitorById.get(monitorId);
      if (monRow && monRow.snoozed_until) {
        const snoozeEnd = new Date(monRow.snoozed_until).getTime();
        if (snoozeEnd > Date.now()) {
          const remainingMin = Math.max(1, Math.round((snoozeEnd - Date.now()) / 60000));
          console.log(`[Vakt Alert] Alert silenced for ${data.monitor?.name || monitorId}: Snoozed for ${remainingMin}m more (until ${monRow.snoozed_until}).`);
          const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          stmtInsertAlertLog.run(logId, 'alert_silenced_snooze', data.monitor?.name || monitorId, 'telegram', 'silenced', `Tystad i ytterligare ${remainingMin}m (till ${monRow.snoozed_until})`, timestamp);
          return results;
        }
      }
    }
  }

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

  // 3. Dispatch Telegram via Bot API
  if (settings.notifyTelegram && settings.telegramBotToken && settings.telegramChatId) {
    try {
      const monitorId = data.monitor?.id || data.monitorId || (event === 'test' ? 'hub' : '');

      let telegramText = '';
      if (event === 'incident_opened') {
        telegramText =
          `🚨 <b>[VAKT LARM] ${escapeHtml(monitorName)} ligger NERE</b>\n\n` +
          `🔗 <b>URL:</b> <code>${escapeHtml(monitorUrl)}</code>\n` +
          `📊 <b>Status:</b> <code>HTTP ${statusCode}</code>\n` +
          `⚡ <b>Latens:</b> <code>${data.latencyMs || 0} ms</code>\n` +
          `⏱ <b>Tid:</b> <code>${timestamp}</code>\n\n` +
          (data.errorPayload
            ? `<b>Fel-payload (JSON):</b>\n<pre>${escapeHtml(data.errorPayload.slice(0, 500))}</pre>`
            : `<i>${escapeHtml(data.errorMsg || 'HTTP-anrop misslyckades')}</i>`);
      } else if (event === 'incident_resolved') {
        const ackNote = data.acknowledgedBy
          ? `\n🛡️ <i>Tidigare kvitterad av ${escapeHtml(data.acknowledgedBy)}.</i>`
          : '';
        telegramText =
          `✅ <b>[VAKT LÖST] ${escapeHtml(monitorName)} är ÅTERSTÄLLD</b>\n\n` +
          `🔗 <b>URL:</b> <code>${escapeHtml(monitorUrl)}</code>\n` +
          `⏱ <b>Total driftstörning:</b> <b>${data.durationSec || 0} sekunder</b>\n` +
          `⚡ <b>Svarstid nu:</b> <code>HTTP 200 (${data.latencyMs || 0} ms)</code>${ackNote}\n` +
          `🛡️ <i>Flottan är åter i normal drift.</i>`;
      } else {
        telegramText =
          `🛡️ <b>[VAKT TEST] Flottans väktare är aktiv</b>\n\n` +
          `Alla 12 Harkco Daily Apps övervakas med 45s radar-svep.\n` +
          `⚡ Latens: <code>${data.latencyMs || 18} ms</code>\n` +
          `✅ Telegram-avisering med tvåvägs kvittering & snooze är aktiv!\n\n` +
          `<i>Tryck på knapparna nedan för att testa tvåvägskvittering & snooze:</i>`;
      }

      // Two-Way Interactive Inline Keyboard
      const inlineKeyboard = [];
      if (monitorId && (event === 'incident_opened' || event === 'test')) {
        inlineKeyboard.push([
          { text: '✅ Kvittera (ACK)', callback_data: `vakt_ack:${monitorId}` },
          { text: '🔕 Tysta 30m', callback_data: `vakt_snooze:30:${monitorId}` },
        ]);
      }
      inlineKeyboard.push([
        { text: '🌐 Öppna Vakt', url: 'https://vakt.apps.harkco.se' },
        ...(monitorUrl && monitorUrl !== 'https://vakt.apps.harkco.se' ? [{ text: '🔗 Öppna App', url: monitorUrl }] : []),
      ]);

      const tgUrl = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
      const res = await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text: telegramText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: inlineKeyboard },
        }),
        signal: AbortSignal.timeout(6000),
      });

      const resJson = await res.json().catch(() => ({}));
      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const statusText = res.ok && resJson.ok ? 'delivered' : `failed (${res.status})`;
      stmtInsertAlertLog.run(logId, event, monitorName, 'telegram', statusText, resJson.description || `HTTP ${res.status}`, timestamp);
      results.push({ channel: 'telegram', status: statusText });
      console.log(`[Vakt Alert] Telegram alert dispatched -> ${statusText}`);
    } catch (err) {
      console.error('[Vakt Alert] Telegram error:', err.message);
      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      stmtInsertAlertLog.run(logId, event, monitorName, 'telegram', 'error', err.message, timestamp);
      results.push({ channel: 'telegram', status: 'error', error: err.message });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3.5 MORNING FLEET HEALTH DIGEST (DAILY TELEGRAM SUMMARY)
// ---------------------------------------------------------------------------
function buildDailyDigest(hours = 24) {
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const monitors = stmtGetMonitors.all();

  let totalProbes = 0;
  let totalUp = 0;
  let totalLatency = 0;

  const appStats = monitors.map((m) => {
    const probes = db
      .prepare('SELECT is_up, latency_ms FROM probe_history WHERE monitor_id = ? AND checked_at >= ?')
      .all(m.id, since);
    const up = probes.filter((p) => p.is_up).length;
    const count = probes.length;
    const uptime = count > 0 ? ((up / count) * 100).toFixed(1) : '100.0';
    const sumLatency = probes.reduce((sum, p) => sum + p.latency_ms, 0);
    const avgLat = count > 0 ? Math.round(sumLatency / count) : 0;

    totalProbes += count;
    totalUp += up;
    totalLatency += sumLatency;

    return {
      id: m.id,
      name: m.name,
      count,
      up,
      uptime,
      avgLat,
    };
  });

  // Sort by average latency ascending
  appStats.sort((a, b) => a.avgLat - b.avgLat);

  const fleetUptime = totalProbes > 0 ? ((totalUp / totalProbes) * 100).toFixed(2) : '100.00';
  const avgFleetLat = totalProbes > 0 ? Math.round(totalLatency / totalProbes) : 0;

  // Query incidents in window
  const recentIncidents = db
    .prepare('SELECT * FROM incidents WHERE started_at >= ? ORDER BY started_at DESC')
    .all(since);

  // Date formatted in Swedish
  const now = new Date();
  const dateFormatted = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(now);
  const capitalizedDate = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);

  const appRowsHtml = appStats
    .map((app) => {
      const dot = Number(app.uptime) >= 99.5 ? '🟢' : Number(app.uptime) >= 95 ? '🟡' : '🔴';
      return `${dot} <b>${escapeHtml(app.name)}</b> — <code>${app.uptime}%</code> · <code>${app.avgLat} ms</code>`;
    })
    .join('\n');

  let incidentsText = '';
  if (recentIncidents.length === 0) {
    incidentsText = '✨ <b>Driftstörningar senaste dygnet:</b> <code>0 incidenter</code> (Felfritt)';
  } else {
    incidentsText =
      `⚠️ <b>Driftstörningar senaste ${hours}h:</b> <code>${recentIncidents.length} st</code>\n` +
      recentIncidents
        .slice(0, 5)
        .map(
          (inc) =>
            `• <b>${escapeHtml(inc.monitor_name)}</b>: ${inc.duration_sec ? `${inc.duration_sec}s nertid` : 'Aktiv störning'}`
        )
        .join('\n');
  }

  const telegramHtml =
    `🌅 <b>[HARKCO VAKT] Morgonrapport för flottan</b>\n` +
    `📅 <i>${escapeHtml(capitalizedDate)} · 08:00 CET</i>\n\n` +
    `🛡️ <b>Flottans status: ${monitors.length}/${monitors.length} Operativa</b>\n` +
    `📊 <b>24h Uptime:</b> <code>${fleetUptime}%</code> (${totalProbes.toLocaleString('sv-SE')} radar-prober)\n` +
    `⚡ <b>Genomsnittlig latens:</b> <code>${avgFleetLat} ms</code>\n` +
    `${incidentsText}\n\n` +
    `<b>App-telemetri (${monitors.length} appar):</b>\n` +
    `${appRowsHtml}\n\n` +
    `🔗 <a href="https://vakt.apps.harkco.se">Öppna Vakt Instrumentpanel</a>`;

  return {
    telegramHtml,
    stats: {
      totalMonitors: monitors.length,
      totalProbes,
      totalUp,
      fleetUptime,
      avgFleetLat,
      incidentsCount: recentIncidents.length,
      appStats,
    },
  };
}

async function sendDailyDigest(isManual = false) {
  const settings = getAlertSettings();
  const timestamp = new Date().toISOString();
  const digest = buildDailyDigest(24);

  if (!settings.telegramBotToken || !settings.telegramChatId) {
    const errorMsg = 'Telegram bot token eller chat ID saknas';
    console.warn(`[Vakt Digest] ${errorMsg}`);
    return { ok: false, error: errorMsg, stats: digest.stats };
  }

  const tgUrl = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
  try {
    const res = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: settings.telegramChatId,
        text: digest.telegramHtml,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const resJson = await res.json().catch(() => ({}));
    const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const eventName = isManual ? 'daily_digest_manual' : 'daily_digest_scheduled';
    const statusText = res.ok && resJson.ok ? 'delivered' : `failed (${res.status})`;

    stmtInsertAlertLog.run(
      logId,
      eventName,
      'Harkco Flotta (24h)',
      'telegram',
      statusText,
      `Uptime: ${digest.stats.fleetUptime}%, Snitt: ${digest.stats.avgFleetLat}ms, Prober: ${digest.stats.totalProbes}`,
      timestamp
    );

    console.log(`[Vakt Digest] Morning digest dispatched to Telegram -> ${statusText}`);
    return { ok: res.ok && resJson.ok, statusText, stats: digest.stats, digestHtml: digest.telegramHtml };
  } catch (err) {
    console.error('[Vakt Digest] Telegram error:', err.message);
    const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    stmtInsertAlertLog.run(
      logId,
      isManual ? 'daily_digest_manual' : 'daily_digest_scheduled',
      'Harkco Flotta (24h)',
      'telegram',
      'error',
      err.message,
      timestamp
    );
    return { ok: false, error: err.message, stats: digest.stats };
  }
}

// Autonomous Self-Healing Action Hook Dispatcher
async function dispatchSelfHealingAction(monitor, failures, settings = null) {
  if (!settings) settings = getAlertSettings();
  const timestamp = new Date().toISOString();
  const hookUrl = settings.actionHookUrl;

  if (!hookUrl || (!hookUrl.startsWith('http://') && !hookUrl.startsWith('https://'))) {
    console.warn(`[Vakt Self-Healing] Skipped: Action hook URL not configured or invalid.`);
    return { success: false, reason: 'unconfigured' };
  }

  const payload = {
    service: 'Vakt',
    event: 'service_self_healing_triggered',
    monitor: {
      id: monitor.id,
      name: monitor.name,
      url: monitor.url,
    },
    consecutiveFailures: failures,
    cooldownMinutes: 10,
    action: 'restart_or_recover',
    timestamp,
  };

  let statusText = 'unknown';
  let details = '';

  try {
    const res = await fetch(hookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Harkco-Vakt-SelfHealing/1.0',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(7000),
    });

    statusText = res.ok ? 'delivered' : `failed (${res.status})`;
    details = `HTTP ${res.status}`;
    console.log(`[Vakt Self-Healing] Action Hook triggered for ${monitor.name} -> ${statusText}`);
  } catch (err) {
    statusText = 'error';
    details = err.message;
    console.error(`[Vakt Self-Healing] Error invoking Action Hook for ${monitor.name}:`, err.message);
  }

  const logId = `heal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  stmtInsertAlertLog.run(logId, 'self_healing_action', monitor.name, 'action_hook', statusText, details, timestamp);

  // Send Telegram notification about self-healing attempt
  if (settings.notifyTelegram && settings.telegramBotToken && settings.telegramChatId) {
    try {
      const tgUrl = `https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`;
      const maskedUrl = hookUrl.replace(/(token|secret|key)=[^&]+/gi, '$1=***');
      const tgText =
        `🔄 <b>[VAKT SJÄLVLÄKNING] Action Hook aktiverad för ${escapeHtml(monitor.name)}</b>\n\n` +
        `⚠️ <b>Orsak:</b> <code>${failures} konsekutiva probe-fel</code> (~${failures * 45}s nertid)\n` +
        `🔗 <b>Övervakad URL:</b> <code>${escapeHtml(monitor.url)}</code>\n` +
        `🛠 <b>Action Hook:</b> <code>${escapeHtml(maskedUrl)}</code>\n` +
        `📡 <b>Resultat:</b> <code>${escapeHtml(statusText)} (${escapeHtml(details)})</code>\n` +
        `⏱ <b>Cooldown:</b> 10 minuters skydd aktivt mot omstart-loopar.`;

      await fetch(tgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          text: tgText,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    } catch (e) {
      // ignore
    }
  }

  return { success: statusText === 'delivered', status: statusText, details };
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

  // Manage Incidents & Consecutive Failure Counter
  const openIncident = stmtGetOpenIncident.get(monitor.id);
  const settings = getAlertSettings();

  if (!isUp) {
    const currentFailures = (consecutiveFailuresMap.get(monitor.id) || 0) + 1;
    consecutiveFailuresMap.set(monitor.id, currentFailures);

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

    // Check if self-healing should trigger
    if (settings.enableSelfHealing && currentFailures >= settings.selfHealingThreshold) {
      const lastAttempt = lastHealingAttemptMap.get(monitor.id) || 0;
      const nowMs = Date.now();
      if (nowMs - lastAttempt > HEALING_COOLDOWN_MS) {
        lastHealingAttemptMap.set(monitor.id, nowMs);
        console.log(`[Vakt Self-Healing] Triggering action hook for ${monitor.name} (${currentFailures} consecutive failures)`);
        dispatchSelfHealingAction(monitor, currentFailures, settings).catch((e) =>
          console.error('[Vakt Self-Healing Dispatch Failed]:', e)
        );
      } else {
        const remainingCooldownSec = Math.round((HEALING_COOLDOWN_MS - (nowMs - lastAttempt)) / 1000);
        console.log(`[Vakt Self-Healing] Cooldown active for ${monitor.name} (${remainingCooldownSec}s remaining). Action hook throttled.`);
      }
    }
  } else {
    // Reset consecutive failures counter on healthy probe
    if ((consecutiveFailuresMap.get(monitor.id) || 0) > 0) {
      consecutiveFailuresMap.set(monitor.id, 0);
    }

    if (openIncident) {
      const durationSec = Math.max(1, Math.round((new Date(checkedAt).getTime() - new Date(openIncident.started_at).getTime()) / 1000));
      stmtResolveIncident.run(checkedAt, durationSec, openIncident.id);
      stmtUnsnoozeMonitor.run(monitor.id);
      console.log(`[Vakt] INCIDENT RESOLVED: ${monitor.name} recovered after ${durationSec}s`);
      dispatchAlert('incident_resolved', {
        monitor,
        statusCode: 200,
        latencyMs,
        durationSec,
        acknowledgedBy: openIncident.acknowledged_by,
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

// Background scheduler for 08:00 CET Morning Fleet Health Digest
setInterval(() => {
  try {
    const settings = getAlertSettings();
    if (!settings.morningDigestEnabled) return;

    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Stockholm',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type) => parts.find((p) => p.type === type)?.value;
    const yyyy = getPart('year');
    const mm = getPart('month');
    const dd = getPart('day');
    const hour = parseInt(getPart('hour'), 10);
    const minute = parseInt(getPart('minute'), 10);
    const dateKey = `${yyyy}-${mm}-${dd}`;

    const targetHour = settings.morningDigestHour || 8;

    // Trigger at targetHour:00 CET (within 0-4 minutes window)
    if (hour === targetHour && minute < 5) {
      if (settings.lastDailyDigestDate !== dateKey) {
        console.log(`[Vakt Digest] Dispatching automated morning digest for ${dateKey} at ${hour}:${minute} CET...`);
        stmtSetSetting.run('last_daily_digest_date', dateKey);
        sendDailyDigest(false).catch((e) => console.error('[Vakt Digest Error]:', e));
      }
    }
  } catch (err) {
    console.error('[Vakt Digest Schedule Error]:', err);
  }
}, 30000);

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

  // GET or HEAD /health
  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/health') {
    const monitors = stmtGetMonitors.all();
    const openIncidents = db.prepare('SELECT count(*) as count FROM incidents WHERE resolved_at IS NULL').get();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.method === 'HEAD') return res.end();
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

  // GET or HEAD /badge/:id.svg or /api/badge/:id.svg (Public Status Shield Badges)
  const badgeMatch = pathname.match(/^\/(?:api\/)?badge\/([a-zA-Z0-9_-]+)\.svg$/);
  if ((req.method === 'GET' || req.method === 'HEAD') && badgeMatch) {
    const targetId = badgeMatch[1].toLowerCase();
    const query = parsedUrl.searchParams;
    const metric = (query.get('metric') || 'status').toLowerCase();
    const customLabel = query.get('label');
    const showDot = query.get('dot') !== 'false';

    let leftText = customLabel || 'Vakt';
    let rightText = 'UNKNOWN';
    let status = 'neutral';

    if (targetId === 'fleet' || targetId === 'harkco' || targetId === 'all') {
      leftText = customLabel || 'Harkco Fleet';
      const monitors = stmtGetMonitors.all();
      const openIncidents = db.prepare('SELECT count(*) as count FROM incidents WHERE resolved_at IS NULL').get()?.count || 0;

      if (metric === 'uptime') {
        let totalUp = 0;
        let totalProbes = 0;
        for (const m of monitors) {
          const hist = stmtGetHistory.all(m.id);
          for (const h of hist) {
            totalProbes++;
            if (h.is_up) totalUp++;
          }
        }
        const fleetUptime = totalProbes > 0 ? (Math.round((totalUp / totalProbes) * 1000) / 10).toFixed(1) : '100';
        rightText = `${fleetUptime}% UPTIME`;
        status = Number(fleetUptime) >= 99 ? 'up' : Number(fleetUptime) >= 95 ? 'degraded' : 'down';
      } else {
        if (openIncidents === 0) {
          rightText = `${monitors.length}/${monitors.length} OPERATIONAL`;
          status = 'up';
        } else {
          rightText = `${openIncidents} INCIDENT${openIncidents > 1 ? 'S' : ''}`;
          status = 'down';
        }
      }
    } else {
      // Find monitor by ID or name
      const monitor = db.prepare('SELECT * FROM monitors WHERE LOWER(id) = ? OR LOWER(name) = ? LIMIT 1').get(targetId, targetId);
      if (monitor) {
        leftText = customLabel || monitor.name;
        const historyDesc = stmtGetHistory.all(monitor.id);
        const latest = historyDesc[0]; // most recent probe
        
        let upCount = 0;
        historyDesc.forEach((h) => { if (h.is_up) upCount++; });
        const uptime24h = historyDesc.length > 0 ? (Math.round((upCount / historyDesc.length) * 1000) / 10).toFixed(1) : '100';
        const latencyMs = latest?.latency_ms || 0;

        let currentStatus = 'up';
        if (latest) {
          if (!latest.is_up) currentStatus = 'down';
          else if (latest.latency_ms > 450) currentStatus = 'degraded';
        }

        if (metric === 'uptime') {
          rightText = `${uptime24h}% UPTIME`;
          status = Number(uptime24h) >= 99 ? 'up' : Number(uptime24h) >= 95 ? 'degraded' : 'down';
        } else if (metric === 'latency') {
          rightText = `${latencyMs} ms`;
          status = latencyMs < 200 ? 'up' : latencyMs < 450 ? 'degraded' : 'down';
        } else {
          // Status metric
          if (currentStatus === 'up') {
            rightText = 'OPERATIONAL';
            status = 'up';
          } else if (currentStatus === 'degraded') {
            rightText = 'DEGRADED';
            status = 'degraded';
          } else {
            rightText = 'OFFLINE';
            status = 'down';
          }
        }
      } else {
        leftText = customLabel || targetId;
        rightText = 'NOT FOUND';
        status = 'neutral';
      }
    }

    const svg = renderSvgBadge({ leftText, rightText, status, showDot });
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=30, s-maxage=30',
    });
    if (req.method === 'HEAD') return res.end();
    res.end(svg);
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
        snoozedUntil: m.snoozed_until || null,
        acknowledgedAt: m.acknowledged_at || null,
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

  // POST /api/probe/:id (Probe single monitor on-demand)
  const probeMatch = pathname.match(/^\/api\/probe\/([a-zA-Z0-9_-]+)$/);
  if (req.method === 'POST' && probeMatch) {
    const monitorId = probeMatch[1];
    const monitor = stmtGetMonitorById.get(monitorId);
    if (!monitor) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Monitor ${monitorId} not found` }));
      return;
    }
    try {
      const probeRes = await probeSingleMonitor(monitor);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', monitorId, probeRes }));
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
      acknowledgedAt: inc.acknowledged_at || null,
      acknowledgedBy: inc.acknowledged_by || null,
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
      telegramChatId: s.telegramChatId,
      telegramConfigured: Boolean(s.telegramBotToken && s.telegramChatId),
      notifyTelegram: s.notifyTelegram,
      notifyOnDown: s.notifyOnDown,
      notifyOnRecovery: s.notifyOnRecovery,
      actionHookUrl: s.actionHookUrl,
      selfHealingThreshold: s.selfHealingThreshold,
      enableSelfHealing: s.enableSelfHealing,
      morningDigestEnabled: s.morningDigestEnabled,
      morningDigestHour: s.morningDigestHour,
      lastDailyDigestDate: s.lastDailyDigestDate,
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
      if (typeof body.telegramBotToken === 'string' && body.telegramBotToken.trim()) {
        stmtSetSetting.run('telegram_bot_token', body.telegramBotToken.trim());
      }
      if (typeof body.telegramChatId === 'string') {
        stmtSetSetting.run('telegram_chat_id', body.telegramChatId.trim());
      }
      if (typeof body.notifyTelegram === 'boolean') {
        stmtSetSetting.run('notify_telegram', body.notifyTelegram ? 'true' : 'false');
      }
      if (typeof body.notifyOnDown === 'boolean') {
        stmtSetSetting.run('notify_on_down', body.notifyOnDown ? 'true' : 'false');
      }
      if (typeof body.notifyOnRecovery === 'boolean') {
        stmtSetSetting.run('notify_on_recovery', body.notifyOnRecovery ? 'true' : 'false');
      }
      if (typeof body.actionHookUrl === 'string') {
        stmtSetSetting.run('action_hook_url', body.actionHookUrl.trim());
      }
      if (typeof body.selfHealingThreshold === 'number' || typeof body.selfHealingThreshold === 'string') {
        const parsed = parseInt(body.selfHealingThreshold, 10);
        if (!isNaN(parsed) && parsed > 0) {
          stmtSetSetting.run('self_healing_threshold', String(parsed));
        }
      }
      if (typeof body.enableSelfHealing === 'boolean') {
        stmtSetSetting.run('enable_self_healing', body.enableSelfHealing ? 'true' : 'false');
      }
      if (typeof body.morningDigestEnabled === 'boolean') {
        stmtSetSetting.run('morning_digest_enabled', body.morningDigestEnabled ? 'true' : 'false');
      }
      if (typeof body.morningDigestHour === 'number' || typeof body.morningDigestHour === 'string') {
        const parsed = parseInt(body.morningDigestHour, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 23) {
          stmtSetSetting.run('morning_digest_hour', String(parsed));
        }
      }

      const updated = getAlertSettings();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        settings: {
          webhookUrl: updated.webhookUrl,
          alertEmail: updated.alertEmail,
          resendApiKeyConfigured: Boolean(updated.resendApiKey),
          telegramChatId: updated.telegramChatId,
          telegramConfigured: Boolean(updated.telegramBotToken && updated.telegramChatId),
          notifyTelegram: updated.notifyTelegram,
          notifyOnDown: updated.notifyOnDown,
          notifyOnRecovery: updated.notifyOnRecovery,
          actionHookUrl: updated.actionHookUrl,
          selfHealingThreshold: updated.selfHealingThreshold,
          enableSelfHealing: updated.enableSelfHealing,
          morningDigestEnabled: updated.morningDigestEnabled,
          morningDigestHour: updated.morningDigestHour,
          lastDailyDigestDate: updated.lastDailyDigestDate,
        },
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/alerts/digest (Manually dispatch morning digest to Telegram)
  if (req.method === 'POST' && pathname === '/api/alerts/digest') {
    try {
      const result = await sendDailyDigest(true);
      res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // GET /api/alerts/digest/preview (Preview 24h fleet digest stats without sending)
  if (req.method === 'GET' && pathname === '/api/alerts/digest/preview') {
    try {
      const digest = buildDailyDigest(24);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(digest));
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
        monitorId: 'hub',
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

  // POST /api/alerts/ack (Two-way incident acknowledgment)
  if (req.method === 'POST' && pathname === '/api/alerts/ack') {
    try {
      const body = await readJsonBody(req);
      const monitorId = (body.monitorId || '').trim();
      const author = (body.author || 'Viktor').trim();

      if (!monitorId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'monitorId is required' }));
        return;
      }

      const monitor = stmtGetMonitorById.get(monitorId) || { id: monitorId, name: monitorId };
      const now = new Date().toISOString();

      stmtAckIncident.run(now, author, monitorId);
      stmtAckMonitor.run(now, monitorId);

      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      stmtInsertAlertLog.run(logId, 'incident_acknowledged', monitor.name, 'telegram', 'delivered', `Kvitterad av ${author}`, now);

      console.log(`[Vakt Alert] Incident for ${monitor.name} (${monitorId}) ACKNOWLEDGED by ${author}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        status: 'acknowledged',
        monitorId,
        monitorName: monitor.name,
        acknowledgedBy: author,
        acknowledgedAt: now,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/alerts/snooze (Two-way silent snooze)
  if (req.method === 'POST' && pathname === '/api/alerts/snooze') {
    try {
      const body = await readJsonBody(req);
      const monitorId = (body.monitorId || '').trim();
      const durationMinutes = parseInt(body.durationMinutes, 10) || 30;
      const author = (body.author || 'Viktor').trim();

      if (!monitorId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'monitorId is required' }));
        return;
      }

      const monitor = stmtGetMonitorById.get(monitorId) || { id: monitorId, name: monitorId };
      const now = new Date().toISOString();
      const snoozedUntil = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

      stmtSnoozeMonitor.run(snoozedUntil, monitorId);

      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      stmtInsertAlertLog.run(logId, 'alert_snoozed', monitor.name, 'telegram', 'delivered', `Tystad i ${durationMinutes}m av ${author} till ${snoozedUntil}`, now);

      console.log(`[Vakt Alert] Alerts for ${monitor.name} (${monitorId}) SNOOZED for ${durationMinutes}m by ${author} until ${snoozedUntil}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        status: 'snoozed',
        monitorId,
        monitorName: monitor.name,
        durationMinutes,
        snoozedUntil,
        snoozedBy: author,
        timestamp: now,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/alerts/unsnooze (Resume alerts)
  if (req.method === 'POST' && pathname === '/api/alerts/unsnooze') {
    try {
      const body = await readJsonBody(req);
      const monitorId = (body.monitorId || '').trim();

      if (!monitorId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'monitorId is required' }));
        return;
      }

      const monitor = stmtGetMonitorById.get(monitorId) || { id: monitorId, name: monitorId };
      const now = new Date().toISOString();

      stmtUnsnoozeMonitor.run(monitorId);

      const logId = `al-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      stmtInsertAlertLog.run(logId, 'alert_unsnoozed', monitor.name, 'telegram', 'delivered', 'Larm återaktiverat', now);

      console.log(`[Vakt Alert] Alerts for ${monitor.name} (${monitorId}) UNSNOOZED`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        status: 'unsnoozed',
        monitorId,
        monitorName: monitor.name,
        timestamp: now,
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // POST /api/alerts/test-action-hook
  if (req.method === 'POST' && pathname === '/api/alerts/test-action-hook') {
    try {
      const s = getAlertSettings();
      if (!s.actionHookUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ingen Action Hook URL konfigurerad. Fyll i en giltig webhook URL först.' }));
        return;
      }
      const result = await dispatchSelfHealingAction(
        { id: 'test-monitor', name: 'Test Service (Självläkning)', url: 'https://vakt.apps.harkco.se' },
        s.selfHealingThreshold || 3,
        s
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', result }));
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
