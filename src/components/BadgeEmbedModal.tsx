import React, { useState, useEffect } from 'react';
import { X, Shield, Copy, Check, ExternalLink, Sparkles, Code2 } from 'lucide-react';
import { Monitor } from '../types';
import { playClick, playAlertSent } from '../utils/audio';

interface BadgeEmbedModalProps {
  isOpen: boolean;
  onClose: () => void;
  monitors: Monitor[];
  initialMonitorId?: string;
}

type BadgeMetric = 'status' | 'uptime' | 'latency';

export const BadgeEmbedModal: React.FC<BadgeEmbedModalProps> = ({
  isOpen,
  onClose,
  monitors,
  initialMonitorId,
}) => {
  const [selectedTarget, setSelectedTarget] = useState<string>('fleet');
  const [selectedMetric, setSelectedMetric] = useState<BadgeMetric>('status');
  const [copiedType, setCopiedType] = useState<'md' | 'html' | 'url' | null>(null);

  useEffect(() => {
    if (initialMonitorId) {
      setSelectedTarget(initialMonitorId);
    } else {
      setSelectedTarget('fleet');
    }
  }, [initialMonitorId, isOpen]);

  if (!isOpen) return null;

  // Build the live SVG URL
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://vakt.apps.harkco.se';
  const queryParams = new URLSearchParams();
  if (selectedMetric !== 'status') {
    queryParams.set('metric', selectedMetric);
  }
  const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
  const badgePath = `/badge/${selectedTarget}.svg${queryString}`;
  const fullBadgeUrl = `${baseUrl}${badgePath}`;

  const selectedMonitor = monitors.find((m) => m.id === selectedTarget);
  const monitorName = selectedTarget === 'fleet' ? 'Harkco Fleet' : (selectedMonitor?.name || selectedTarget);

  const markdownSnippet = `[![${monitorName} Status](${fullBadgeUrl})](https://vakt.apps.harkco.se)`;
  const htmlSnippet = `<a href="https://vakt.apps.harkco.se" target="_blank" rel="noopener noreferrer"><img src="${fullBadgeUrl}" alt="${monitorName} Status" /></a>`;

  const handleCopy = (text: string, type: 'md' | 'html' | 'url') => {
    playAlertSent();
    navigator.clipboard.writeText(text).then(() => {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2500);
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end transition-opacity">
      <div
        className="w-full max-w-lg bg-[#080C14] border-l border-[#1A2438] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="p-6 border-b border-[#1A2438] flex items-center justify-between bg-[#0E1422]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white font-serif tracking-tight">
                  Status Shields & Embeds
                </h2>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 font-bold uppercase">
                  SVG Live
                </span>
              </div>
              <p className="text-xs text-zinc-400 font-mono">Dynamiska sköldar för READMEs & webbplatser</p>
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
          {/* Target & Metric Controls */}
          <div className="space-y-4 p-4 rounded-xl bg-[#0E1422] border border-[#1A2438]">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 font-mono">Välj App / Flotta</label>
              <select
                value={selectedTarget}
                onChange={(e) => {
                  playClick();
                  setSelectedTarget(e.target.value);
                }}
                className="w-full bg-[#080C14] border border-[#1A2438] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500 font-mono transition-colors"
              >
                <option value="fleet">🛡️ Harkco Fleet (Hela flottans status)</option>
                <optgroup label="Enskilda Appar">
                  {monitors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.currentStatus === 'up' ? '🟢 UP' : m.currentStatus === 'degraded' ? '🟡 LÅNGSAM' : '🔴 NERE'})
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-zinc-300 font-mono">Mätvärde (Metrik)</label>
              <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => {
                    playClick();
                    setSelectedMetric('status');
                  }}
                  className={`py-2 px-3 rounded-lg border transition text-center ${
                    selectedMetric === 'status'
                      ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-bold'
                      : 'bg-[#080C14] border-[#1A2438] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Status
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playClick();
                    setSelectedMetric('uptime');
                  }}
                  className={`py-2 px-3 rounded-lg border transition text-center ${
                    selectedMetric === 'uptime'
                      ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-bold'
                      : 'bg-[#080C14] border-[#1A2438] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  24h Uptime
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playClick();
                    setSelectedMetric('latency');
                  }}
                  className={`py-2 px-3 rounded-lg border transition text-center ${
                    selectedMetric === 'latency'
                      ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300 font-bold'
                      : 'bg-[#080C14] border-[#1A2438] text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Latens (ms)
                </button>
              </div>
            </div>
          </div>

          {/* Live Preview Display */}
          <div className="p-5 rounded-xl bg-[#0E1422] border border-[#1A2438] space-y-3">
            <div className="flex items-center justify-between text-xs font-mono text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                Live SVG Preview
              </span>
              <span className="text-[10px] text-zinc-500">Uppdateras var 30:e sek</span>
            </div>

            <div className="p-6 rounded-lg bg-[#080C14] border border-[#1A2438] flex items-center justify-center min-h-[70px]">
              <img
                src={fullBadgeUrl}
                alt="Live Status Shield"
                className="h-5 drop-shadow-sm transition-all"
              />
            </div>
          </div>

          {/* Embed Code Snippets */}
          <div className="space-y-4">
            <h3 className="text-xs font-bold text-zinc-300 font-mono uppercase tracking-wider flex items-center gap-2">
              <Code2 className="w-4 h-4 text-cyan-400" />
              Inbäddningskoder
            </h3>

            {/* Markdown Snippet */}
            <div className="p-4 rounded-xl bg-[#0E1422] border border-[#1A2438] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-zinc-200">GitHub README (Markdown)</span>
                <button
                  onClick={() => handleCopy(markdownSnippet, 'md')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#182035] hover:bg-[#202B48] border border-[#2E3D60] text-emerald-300 text-[11px] transition"
                >
                  {copiedType === 'md' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Kopierad!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Kopiera</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-2.5 rounded bg-[#080C14] border border-[#1A2438] text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap select-all">
                {markdownSnippet}
              </pre>
            </div>

            {/* HTML Snippet */}
            <div className="p-4 rounded-xl bg-[#0E1422] border border-[#1A2438] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-zinc-200">Webbplats / Footer (HTML)</span>
                <button
                  onClick={() => handleCopy(htmlSnippet, 'html')}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#182035] hover:bg-[#202B48] border border-[#2E3D60] text-emerald-300 text-[11px] transition"
                >
                  {copiedType === 'html' ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-400">Kopierad!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>Kopiera</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-2.5 rounded bg-[#080C14] border border-[#1A2438] text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap select-all">
                {htmlSnippet}
              </pre>
            </div>

            {/* Direct URL */}
            <div className="p-4 rounded-xl bg-[#0E1422] border border-[#1A2438] space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="font-semibold text-zinc-200">Direkt SVG-länk</span>
                <div className="flex items-center gap-2">
                  <a
                    href={fullBadgeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-400 hover:text-white transition"
                    title="Öppna i ny flik"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    onClick={() => handleCopy(fullBadgeUrl, 'url')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#182035] hover:bg-[#202B48] border border-[#2E3D60] text-emerald-300 text-[11px] transition"
                  >
                    {copiedType === 'url' ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Kopierad!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Kopiera</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
              <pre className="p-2.5 rounded bg-[#080C14] border border-[#1A2438] text-[11px] font-mono text-zinc-300 overflow-x-auto whitespace-pre-wrap select-all">
                {fullBadgeUrl}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
