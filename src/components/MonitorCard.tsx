import React from 'react';
import { Monitor } from '../types';
import { ExternalLink, Terminal, Trash2, Shield } from 'lucide-react';
import { playClick } from '../utils/audio';

interface MonitorCardProps {
  monitor: Monitor;
  onInspectJson: (monitor: Monitor) => void;
  onOpenBadgeModal?: (monitorId: string) => void;
  onDeleteMonitor?: (id: string) => void;
}

export const MonitorCard: React.FC<MonitorCardProps> = ({
  monitor,
  onInspectJson,
  onOpenBadgeModal,
  onDeleteMonitor,
}) => {
  const isUp = monitor.currentStatus === 'up';
  const isDegraded = monitor.currentStatus === 'degraded';

  const statusBg = isUp 
    ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/30' 
    : isDegraded 
    ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/30' 
    : 'bg-[#EF4444]/15 text-[#EF4444] border-[#EF4444]/30';

  return (
    <div className="p-4 sm:p-5 rounded-xl bg-[#0E1422] border border-[#1A2438] hover:border-[#263552] transition flex flex-col justify-between gap-4">
      
      {/* Top Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-base text-white truncate">
              {monitor.name}
            </h3>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border uppercase ${statusBg}`}>
              {isUp ? `${monitor.expectedStatus} OK` : isDegraded ? 'LÅNGSAM' : 'OFFLINE'}
            </span>
          </div>

          <a
            href={monitor.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#64748B] hover:text-[#94A3B8] font-mono mt-1 flex items-center gap-1 truncate transition"
          >
            <span>{monitor.url}</span>
            <ExternalLink className="w-3 h-3 shrink-0" />
          </a>
        </div>

        {/* Latency Pill */}
        <div className="text-right shrink-0">
          <div className="font-mono text-lg font-black text-white">
            {monitor.lastLatencyMs} <span className="text-xs font-normal text-[#64748B]">ms</span>
          </div>
          <div className="text-[10px] font-mono text-[#64748B]">
            {monitor.uptime24h}% 24h
          </div>
        </div>
      </div>

      {/* Latency Sparkline Bars (20 points) */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] font-mono text-[#64748B]">
          <span>Historik (senaste 20 probningar)</span>
          <span>{monitor.lastLatencyMs} ms</span>
        </div>

        <div className="flex items-end gap-1 h-7 bg-[#080C14] p-1 rounded-lg border border-[#1A2438]/80">
          {monitor.history.map((h, idx) => {
            const heightPct = Math.min(100, Math.max(15, (h.latencyMs / 300) * 100));
            let barColor = 'bg-[#10B981]';
            if (!h.isUp) barColor = 'bg-[#EF4444]';
            else if (h.latencyMs > 350) barColor = 'bg-[#F59E0B]';

            return (
              <div
                key={idx}
                className="flex-1 rounded-xs transition-all relative group cursor-pointer"
                style={{ height: `${heightPct}%` }}
                title={`${new Date(h.checkedAt).toLocaleTimeString('sv-SE')}: ${h.statusCode} (${h.latencyMs}ms)`}
              >
                <div className={`w-full h-full rounded-xs ${barColor}`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="pt-2 border-t border-[#1A2438] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              playClick();
              onInspectJson(monitor);
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#080C14] hover:bg-[#141C30] border border-[#1A2438] hover:border-[#263552] text-xs font-mono text-[#94A3B8] hover:text-white transition cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-[#06B6D4]" />
            <span>JSON</span>
          </button>

          {onOpenBadgeModal && (
            <button
              type="button"
              onClick={() => {
                playClick();
                onOpenBadgeModal(monitor.id);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#080C14] hover:bg-[#141C30] border border-[#1A2438] hover:border-emerald-500/40 text-xs font-mono text-emerald-400 hover:text-emerald-300 transition cursor-pointer"
              title={`Hämta SVG-sköld för ${monitor.name}`}
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Sköld</span>
            </button>
          )}
        </div>

        {monitor.group === 'Custom' && onDeleteMonitor && (
          <button
            type="button"
            onClick={() => {
              playClick();
              if (window.confirm(`Vill du ta bort monitorn "${monitor.name}"?`)) {
                onDeleteMonitor(monitor.id);
              }
            }}
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#EF4444] transition cursor-pointer"
            title="Ta bort monitor"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

    </div>
  );
};
