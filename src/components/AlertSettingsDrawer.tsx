import React, { useState, useEffect } from 'react';
import { X, Bell, Webhook, Mail, CheckCircle2, AlertTriangle, Send, ShieldCheck, Key, RefreshCw, MessageSquare, RotateCcw, Zap } from 'lucide-react';
import { AlertSettings, AlertLog } from '../types';
import { playClick, playAlertSent } from '../utils/audio';

interface AlertSettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AlertSettingsDrawer: React.FC<AlertSettingsDrawerProps> = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState<AlertSettings>({
    webhookUrl: '',
    alertEmail: '',
    resendApiKeyConfigured: false,
    telegramChatId: '',
    telegramConfigured: false,
    notifyTelegram: true,
    notifyOnDown: true,
    notifyOnRecovery: true,
    actionHookUrl: '',
    selfHealingThreshold: 3,
    enableSelfHealing: false,
  });
  const [resendApiKeyInput, setResendApiKeyInput] = useState('');
  const [telegramBotTokenInput, setTelegramBotTokenInput] = useState('');
  const [logs, setLogs] = useState<AlertLog[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isTestingActionHook, setIsTestingActionHook] = useState(false);
  const [testResult, setTestResult] = useState<{ message: string; success: boolean } | null>(null);
  const [actionHookResult, setActionHookResult] = useState<{ message: string; success: boolean } | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadSettings();
      loadLogs();
      setTestResult(null);
      setActionHookResult(null);
      setSaveSuccess(false);
    }
  }, [isOpen]);

  async function loadSettings() {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings({
          ...data,
          selfHealingThreshold: data.selfHealingThreshold || 3,
          enableSelfHealing: Boolean(data.enableSelfHealing),
          actionHookUrl: data.actionHookUrl || '',
        });
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  }

  async function loadLogs() {
    try {
      const res = await fetch('/api/alerts/logs');
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to load alert logs:', err);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    playClick();

    try {
      const payload: Record<string, unknown> = {
        webhookUrl: settings.webhookUrl.trim(),
        alertEmail: settings.alertEmail.trim(),
        telegramChatId: settings.telegramChatId.trim(),
        notifyTelegram: settings.notifyTelegram,
        notifyOnDown: settings.notifyOnDown,
        notifyOnRecovery: settings.notifyOnRecovery,
        actionHookUrl: settings.actionHookUrl.trim(),
        selfHealingThreshold: Number(settings.selfHealingThreshold) || 3,
        enableSelfHealing: settings.enableSelfHealing,
      };

      if (resendApiKeyInput.trim()) {
        payload.resendApiKey = resendApiKeyInput.trim();
      }

      if (telegramBotTokenInput.trim()) {
        payload.telegramBotToken = telegramBotTokenInput.trim();
      }

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const updated = await res.json();
        setSettings(updated.settings);
        setResendApiKeyInput('');
        setTelegramBotTokenInput('');
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestAlert() {
    setIsTesting(true);
    setTestResult(null);
    playClick();

    try {
      const res = await fetch('/api/alerts/test', { method: 'POST' });
      const data = await res.json();
      playAlertSent();
      if (res.ok) {
        setTestResult({
          success: true,
          message: data.results?.length
            ? `Test skickat till: ${data.results.map((r: { channel: string }) => r.channel).join(', ')}`
            : 'Test-anrop utfört (inga kanaler aktiverade ännu)',
        });
        loadLogs();
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Test misslyckades',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Nätverksfel';
      setTestResult({ success: false, message: msg });
    } finally {
      setIsTesting(false);
    }
  }

  async function handleTestActionHook() {
    setIsTestingActionHook(true);
    setActionHookResult(null);
    playClick();

    try {
      const res = await fetch('/api/alerts/test-action-hook', { method: 'POST' });
      const data = await res.json();
      playAlertSent();
      if (res.ok) {
        setActionHookResult({
          success: true,
          message: `Action hook anropad (${data.result?.status || 'ok'})`,
        });
        loadLogs();
      } else {
        setActionHookResult({
          success: false,
          message: data.error || 'Test av action hook misslyckades',
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Nätverksfel';
      setActionHookResult({ success: false, message: msg });
    } finally {
      setIsTestingActionHook(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end transition-opacity">
      <div 
        className="w-full max-w-lg bg-[#0d1117] border-l border-[#30363d] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-6 border-b border-[#21262d] flex items-center justify-between bg-[#161b22]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Bell className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight flex items-center gap-2">
                Larm & Aviseringar
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-900/50 text-emerald-300 border border-emerald-500/20">
                  Resend & Webhooks
                </span>
              </h2>
              <p className="text-xs text-zinc-400 font-mono">Autonom incident-dispatch vid statusavvikelser</p>
            </div>
          </div>
          <button
            onClick={() => {
              playClick();
              onClose();
            }}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/60 transition-colors"
            title="Stäng (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <form onSubmit={handleSave} className="space-y-5">
            {/* Webhook Configuration */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                <Webhook className="w-4 h-4 text-emerald-400" />
                Webhook URL (Discord / Slack / Telegram)
              </label>
              <input
                type="url"
                value={settings.webhookUrl}
                onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })}
                placeholder="https://discord.com/api/webhooks/... eller HTTP endpoint"
                className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
              />
              <p className="text-[11px] text-zinc-500">
                Skickar JSON payload med monitor-namn, fel-payload, HTTP-status och tidsstämpel vid varje incident.
              </p>
            </div>

            {/* Email / Resend Configuration */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                <Mail className="w-4 h-4 text-emerald-400" />
                E-postmottagare för Larm
              </label>
              <input
                type="email"
                value={settings.alertEmail}
                onChange={(e) => setSettings({ ...settings, alertEmail: e.target.value })}
                placeholder="viktor@harkco.se"
                className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
              />
            </div>

            {/* Resend API Key */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                  <Key className="w-4 h-4 text-amber-400" />
                  Resend API Key
                </label>
                {settings.resendApiKeyConfigured && (
                  <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Konfigurerad
                  </span>
                )}
              </div>
              <input
                type="password"
                value={resendApiKeyInput}
                onChange={(e) => setResendApiKeyInput(e.target.value)}
                placeholder={settings.resendApiKeyConfigured ? '•••••••••••••••• (Aktiv i backend)' : 're_123456789... (valfri egen nyckel)'}
                className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono transition-colors"
              />
              <p className="text-[11px] text-zinc-500">
                Skickar formaterade HTML incident-kort via Resend REST API med exakt JSON fel-payload.
              </p>
            </div>

            {/* Telegram Bot Notification */}
            <div className="space-y-3 pt-2 border-t border-[#21262d]">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-sky-400" />
                  Telegram Bot Direkt-avisering
                </label>
                {settings.telegramConfigured && (
                  <span className="text-[10px] text-sky-400 font-mono flex items-center gap-1 bg-sky-950/60 border border-sky-500/30 px-2 py-0.5 rounded">
                    <CheckCircle2 className="w-3 h-3" /> Bot Aktiv
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-zinc-400 font-mono">Telegram Chat ID</label>
                <input
                  type="text"
                  value={settings.telegramChatId}
                  onChange={(e) => setSettings({ ...settings, telegramChatId: e.target.value })}
                  placeholder="7684080020"
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 font-mono transition-colors"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] text-zinc-400 font-mono">Telegram Bot Token (Valfritt eget token)</label>
                <input
                  type="password"
                  value={telegramBotTokenInput}
                  onChange={(e) => setTelegramBotTokenInput(e.target.value)}
                  placeholder={settings.telegramConfigured ? '•••••••••••••••• (Standard Harkco Sentinel Bot)' : '8917459869:AA...'}
                  className="w-full bg-[#161b22] border border-[#30363d] rounded-lg px-3.5 py-2.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-sky-500 font-mono transition-colors"
                />
                <p className="text-[11px] text-zinc-500">
                  Levererar realtids-incidenter med JSON-felutdrag direkt i din privata Telegram-chatt.
                </p>
              </div>

              <label className="flex items-start gap-3 p-3 rounded-lg bg-[#161b22] border border-[#30363d] cursor-pointer hover:border-zinc-600 transition-colors">
                <input
                  type="checkbox"
                  checked={settings.notifyTelegram}
                  onChange={(e) => setSettings({ ...settings, notifyTelegram: e.target.checked })}
                  className="mt-0.5 rounded border-[#30363d] text-sky-500 focus:ring-0 bg-[#0d1117]"
                />
                <div className="flex-1">
                  <div className="text-xs font-medium text-white flex items-center gap-2">
                    Skicka Larm till Telegram
                    <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Skicka snabba meddelanden med direktlänk och driftstoppstid till Telegram-chatten.
                  </p>
                </div>
              </label>
            </div>

            {/* Trigger Options */}
            <div className="pt-2 border-t border-[#21262d] space-y-3">
              <label className="text-xs font-semibold text-zinc-300 block">Aviseringshändelser</label>
              
              <label className="flex items-start gap-3 p-3 rounded-lg bg-[#161b22] border border-[#30363d] cursor-pointer hover:border-zinc-600 transition-colors">
                <input
                  type="checkbox"
                  checked={settings.notifyOnDown}
                  onChange={(e) => setSettings({ ...settings, notifyOnDown: e.target.checked })}
                  className="mt-0.5 rounded border-[#30363d] text-rose-500 focus:ring-0 bg-[#0d1117]"
                />
                <div className="flex-1">
                  <div className="text-xs font-medium text-white flex items-center gap-2">
                    Larma vid Driftstörning (Status != 200)
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Skicka omedelbart larm med extraherad JSON felkropp när en app returnerar 4xx/5xx eller timeout.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 rounded-lg bg-[#161b22] border border-[#30363d] cursor-pointer hover:border-zinc-600 transition-colors">
                <input
                  type="checkbox"
                  checked={settings.notifyOnRecovery}
                  onChange={(e) => setSettings({ ...settings, notifyOnRecovery: e.target.checked })}
                  className="mt-0.5 rounded border-[#30363d] text-emerald-500 focus:ring-0 bg-[#0d1117]"
                />
                <div className="flex-1">
                  <div className="text-xs font-medium text-white flex items-center gap-2">
                    Avisera vid Återhämtning (Recovery)
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Skicka bekräftelse när tjänsten svarar med 200 OK igen, inklusive total driftstoppstid i sekunder.
                  </p>
                </div>
              </label>
            </div>

            {/* Autonomous Self-Healing / Restart Action Hooks */}
            <div className="space-y-3 pt-2 border-t border-[#21262d]">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-2">
                  <RotateCcw className="w-4 h-4 text-amber-400" />
                  Automatisk Självläkning (Action Hooks)
                </label>
                {settings.enableSelfHealing && settings.actionHookUrl && (
                  <span className="text-[10px] text-amber-400 font-mono flex items-center gap-1 bg-amber-950/60 border border-amber-500/30 px-2 py-0.5 rounded">
                    <Zap className="w-3 h-3 text-amber-400" /> Aktiv Sentinel
                  </span>
                )}
              </div>

              <label className="flex items-start gap-3 p-3 rounded-lg bg-[#161b22] border border-[#30363d] cursor-pointer hover:border-zinc-600 transition-colors">
                <input
                  type="checkbox"
                  checked={settings.enableSelfHealing}
                  onChange={(e) => setSettings({ ...settings, enableSelfHealing: e.target.checked })}
                  className="mt-0.5 rounded border-[#30363d] text-amber-500 focus:ring-0 bg-[#0d1117]"
                />
                <div className="flex-1">
                  <div className="text-xs font-medium text-white flex items-center gap-2">
                    Aktivera Självläkande Action Hooks
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    Trigga automatiskt omstart/maintenance webhook när en monitor fallerat flera gånger i rad.
                  </p>
                </div>
              </label>

              {settings.enableSelfHealing && (
                <div className="space-y-3 p-3.5 rounded-lg bg-[#161b22]/70 border border-[#30363d] animate-in fade-in duration-150">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-zinc-300 font-mono">
                      Action Hook URL (Coolify Webhook / Restart Endpoint)
                    </label>
                    <input
                      type="url"
                      value={settings.actionHookUrl}
                      onChange={(e) => setSettings({ ...settings, actionHookUrl: e.target.value })}
                      placeholder="https://coolify.apps.harkco.se/api/v1/deploy?uuid=... eller HTTP URL"
                      className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono transition-colors"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3 items-center">
                    <div className="space-y-1.5">
                      <label className="text-[11px] text-zinc-300 font-mono">
                        Tröskelvärde (Probe-fel)
                      </label>
                      <select
                        value={settings.selfHealingThreshold}
                        onChange={(e) => setSettings({ ...settings, selfHealingThreshold: Number(e.target.value) })}
                        className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-500 font-mono transition-colors"
                      >
                        <option value={2}>2 fel i rad (~90 sek)</option>
                        <option value={3}>3 fel i rad (~135 sek) - Standard</option>
                        <option value={4}>4 fel i rad (~180 sek)</option>
                        <option value={5}>5 fel i rad (~225 sek)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] text-zinc-300 font-mono">
                        Loop-skydd (Cooldown)
                      </label>
                      <div className="px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d] text-xs text-zinc-400 font-mono flex items-center justify-between">
                        <span>10 minuter</span>
                        <span className="text-[10px] text-emerald-400">Skydd aktivt</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-1 flex items-center justify-between">
                    <p className="text-[10px] text-zinc-500 font-mono">
                      Skickar POST med JSON incidentdata och loggar i audit-trail.
                    </p>
                    <button
                      type="button"
                      onClick={handleTestActionHook}
                      disabled={isTestingActionHook || !settings.actionHookUrl}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#21262d] hover:bg-[#30363d] text-amber-300 text-[11px] font-mono border border-amber-500/20 transition-colors disabled:opacity-50"
                    >
                      {isTestingActionHook ? (
                        <RefreshCw className="w-3 h-3 animate-spin" />
                      ) : (
                        <Zap className="w-3 h-3" />
                      )}
                      Testa Action Hook
                    </button>
                  </div>

                  {actionHookResult && (
                    <div
                      className={`p-2.5 rounded text-xs font-mono flex items-center gap-2 ${
                        actionHookResult.success
                          ? 'bg-emerald-950/60 border border-emerald-500/30 text-emerald-400'
                          : 'bg-rose-950/60 border border-rose-500/30 text-rose-400'
                      }`}
                    >
                      {actionHookResult.success ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      )}
                      {actionHookResult.message}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action Bar */}
            <div className="pt-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-[#0c1017] font-semibold text-xs transition-colors shadow-sm disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Sparar...
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    Spara Inställningar
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleTestAlert}
                disabled={isTesting}
                className="inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-zinc-200 font-medium text-xs border border-[#30363d] transition-colors disabled:opacity-50"
              >
                {isTesting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                ) : (
                  <Send className="w-3.5 h-3.5 text-zinc-400" />
                )}
                Testa Larm
              </button>
            </div>

            {saveSuccess && (
              <div className="p-3 rounded-lg bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 text-xs font-mono flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Inställningar sparade framgångsrikt i SQLite!
              </div>
            )}

            {testResult && (
              <div
                className={`p-3 rounded-lg text-xs font-mono flex items-center gap-2 ${
                  testResult.success
                    ? 'bg-emerald-950/60 border border-emerald-500/30 text-emerald-400'
                    : 'bg-rose-950/60 border border-rose-500/30 text-rose-400'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                {testResult.message}
              </div>
            )}
          </form>

          {/* Recent Alert Dispatches */}
          <div className="pt-4 border-t border-[#21262d] space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-zinc-300 font-mono tracking-wider uppercase">
                Utskickade Larm ({logs.length})
              </h3>
              <button
                onClick={loadLogs}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 font-mono"
              >
                <RefreshCw className="w-3 h-3" /> Uppdatera
              </button>
            </div>

            {logs.length === 0 ? (
              <div className="p-4 rounded-lg bg-[#161b22] border border-[#21262d] text-center text-xs text-zinc-500 font-mono">
                Inga larm har skickats ännu. Klicka på "Testa Larm" ovan för att verifiera anslutningen.
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-lg bg-[#161b22] border border-[#21262d] flex items-center justify-between text-xs font-mono"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            log.event === 'incident_opened'
                              ? 'bg-rose-500'
                              : log.event === 'incident_resolved'
                              ? 'bg-emerald-500'
                              : log.event === 'self_healing_action'
                              ? 'bg-amber-400'
                              : 'bg-blue-400'
                          }`}
                        />
                        <span className="font-semibold text-zinc-200">{log.monitor_name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                          log.channel === 'telegram'
                            ? 'bg-sky-950/70 text-sky-300 border-sky-500/30'
                            : log.channel === 'webhook'
                            ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/30'
                            : log.channel === 'action_hook'
                            ? 'bg-amber-950/70 text-amber-300 border-amber-500/30'
                            : 'bg-purple-950/70 text-purple-300 border-purple-500/30'
                        }`}>
                          {log.channel}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate max-w-xs">
                        {log.status} {log.details ? `— ${log.details}` : ''}
                      </div>
                    </div>
                    <div className="text-[10px] text-zinc-500 shrink-0">
                      {new Date(log.dispatched_at).toLocaleTimeString('sv-SE', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
