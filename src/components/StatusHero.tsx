import React from 'react';
import { FleetStats } from '../types';
import { ShieldCheck, AlertTriangle, RefreshCw, Zap, Clock, Activity } from 'lucide-react';
import { playClick } from '../utils/audio';

interface StatusHeroProps {
  stats: FleetStats;
  isProbing: boolean;
  onProbeNow: () => void;
}

export const StatusHero: React.FC<StatusHeroProps> = ({
  stats,
  isProbing,
  onProbeNow,
}) => {
  const isHealthy = stats.incidentCount === 0;

  return (
    <div className="bg-[#0E1422] border border-[#1A2438] rounded-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
      
      {/* Background ambient glow */}
      <div className={`absolute -top-32 -left-32 w-80 h-80 rounded-full blur-3xl pointer-events-none transition-opacity duration-700 ${
        isHealthy ? 'bg-[#10B981]/10' : 'bg-[#EF4444]/15'
      }`} />
      
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-[#1A2438]">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#080C14] border border-[#1A2438] text-xs font-mono mb-3">
            <span className={`w-2 h-2 rounded-full ${isHealthy ? 'bg-[#10B981] animate-pulse' : 'bg-[#EF4444] animate-ping'}`} />
            <span className={isHealthy ? 'text-[#10B981] font-bold' : 'text-[#EF4444] font-bold'}>
              {isHealthy ? 'ALLA TJÄNSTER OPERATIVA' : `${stats.incidentCount} INCIDENT RAPPORTERAD`}
            </span>
            <span className="text-[#64748B]">•</span>
            <span className="text-[#94A3B8]">{stats.totalMonitors} aktiva endpoints</span>
          </div>

          <h1 className="font-serif text-3xl sm:text-4xl font-black tracking-tight text-white">
            {isHealthy ? 'Flottans hälsa är optimal' : 'Vakt har fångat en driftstörning'}
          </h1>
          <p className="text-sm text-[#94A3B8] mt-2 max-w-xl leading-relaxed">
            Kontinuerlig probning av /health-endpoints, svarstider i millisekunder och automatisk fångst av JSON-felmeddelanden.
          </p>
        </div>

        {/* Primary Action: Probe All Now */}
        <div className="shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <button
            type="button"
            onClick={() => {
              playClick();
              onProbeNow();
            }}
            disabled={isProbing}
            className="px-5 py-3 rounded-xl bg-[#10B981] hover:bg-[#059669] text-black font-mono font-bold text-sm flex items-center justify-center gap-2.5 transition shadow-radar cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${isProbing ? 'animate-spin' : ''}`} />
            <span>{isProbing ? 'Probar flottan...' : 'PROBA ALLA NU'}</span>
          </button>
        </div>
      </div>

      {/* Fleet Telemetry Metric Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 text-xs font-mono">
        <div className="p-3.5 rounded-xl bg-[#080C14]/70 border border-[#1A2438]">
          <div className="text-[11px] text-[#64748B] flex items-center gap-1.5 uppercase tracking-wider">
            <Activity className="w-3.5 h-3.5 text-[#10B981]" />
            <span>24h Uptime</span>
          </div>
          <div className="text-2xl font-black text-white mt-1">
            {stats.overallUptimePercent.toFixed(2)}%
          </div>
          <div className="text-[10px] text-[#10B981] mt-0.5">SLA Mål: 99.9%</div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#080C14]/70 border border-[#1A2438]">
          <div className="text-[11px] text-[#64748B] flex items-center gap-1.5 uppercase tracking-wider">
            <Zap className="w-3.5 h-3.5 text-[#06B6D4]" />
            <span>Snittsvarstid</span>
          </div>
          <div className="text-2xl font-black text-white mt-1">
            {stats.averageLatencyMs} <span className="text-xs font-normal text-[#64748B]">ms</span>
          </div>
          <div className="text-[10px] text-[#06B6D4] mt-0.5">Fleet median latency</div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#080C14]/70 border border-[#1A2438]">
          <div className="text-[11px] text-[#64748B] flex items-center gap-1.5 uppercase tracking-wider">
            <Clock className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>Prob-kadens</span>
          </div>
          <div className="text-2xl font-black text-white mt-1">
            45 <span className="text-xs font-normal text-[#64748B]">sek</span>
          </div>
          <div className="text-[10px] text-[#F59E0B] mt-0.5">Automatisk loop</div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#080C14]/70 border border-[#1A2438]">
          <div className="text-[11px] text-[#64748B] flex items-center gap-1.5 uppercase tracking-wider">
            {isHealthy ? (
              <ShieldCheck className="w-3.5 h-3.5 text-[#10B981]" />
            ) : (
              <AlertTriangle className="w-3.5 h-3.5 text-[#EF4444]" />
            )}
            <span>Status</span>
          </div>
          <div className={`text-2xl font-black mt-1 ${isHealthy ? 'text-[#10B981]' : 'text-[#EF4444]'}`}>
            {isHealthy ? '100% OK' : 'Incident'}
          </div>
          <div className="text-[10px] text-[#64748B] mt-0.5 truncate">
            {new Date(stats.lastGlobalProbe).toLocaleTimeString('sv-SE')}
          </div>
        </div>
      </div>

    </div>
  );
};
