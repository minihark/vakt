import React from 'react';
import { ShieldCheck, Plus, Sparkles, Volume2, VolumeX, Radio } from 'lucide-react';
import { playClick } from '../utils/audio';

interface NavbarProps {
  isMuted: boolean;
  onToggleMute: () => void;
  onOpenAddModal: () => void;
  onOpenProModal: () => void;
  isPro: boolean;
  incidentCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  isMuted,
  onToggleMute,
  onOpenAddModal,
  onOpenProModal,
  isPro,
  incidentCount,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-[#080C14]/90 backdrop-blur-md border-b border-[#1A2438] px-4 sm:px-6 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-[#0E1422] border border-[#1A2438] shadow-radar">
            <Radio className="w-5 h-5 text-[#10B981] animate-pulse" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#10B981] animate-ping" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-serif text-xl font-bold tracking-tight text-white">
                Vakt
              </span>
              <span className="font-mono text-[10px] tracking-wider uppercase px-2 py-0.5 rounded bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/25 font-bold">
                Sentinel
              </span>
            </div>
            <p className="text-[11px] text-[#64748B] hidden sm:block font-mono">
              Harkco Fleet Uptime & JSON Error Alerting
            </p>
          </div>
        </div>

        {/* Right Action Controls */}
        <div className="flex items-center gap-2 sm:gap-3 text-xs font-mono">
          
          {/* Status Indicator */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#0E1422] border border-[#1A2438]">
            <span className={`w-2 h-2 rounded-full ${incidentCount === 0 ? 'bg-[#10B981] animate-pulse' : 'bg-[#EF4444] animate-ping'}`} />
            <span className={incidentCount === 0 ? 'text-[#10B981] font-bold' : 'text-[#EF4444] font-bold'}>
              {incidentCount === 0 ? 'FLOTTAN OPERATIV' : `${incidentCount} INCIDENT`}
            </span>
          </div>

          {/* Add Monitor Button */}
          <button
            type="button"
            onClick={() => {
              playClick();
              onOpenAddModal();
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0E1422] hover:bg-[#141C30] border border-[#1A2438] hover:border-[#263552] text-white transition font-medium"
          >
            <Plus className="w-3.5 h-3.5 text-[#10B981]" />
            <span className="hidden sm:inline">Ny Monitor</span>
          </button>

          {/* Audio Mute/Unmute */}
          <button
            type="button"
            onClick={onToggleMute}
            className={`p-1.5 rounded-lg border transition ${
              isMuted
                ? 'bg-[#0E1422] border-[#1A2438] text-[#64748B]'
                : 'bg-[#0E1422] border-[#10B981]/40 text-[#10B981]'
            }`}
            title={isMuted ? 'Slå på ljudvarningar' : 'Stäng av ljudvarningar'}
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Pro Pill / Modal */}
          {isPro ? (
            <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981] font-bold text-[11px]">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Pro</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                playClick();
                onOpenProModal();
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#F59E0B]/10 hover:bg-[#F59E0B]/20 border border-[#F59E0B]/40 text-[#F59E0B] font-bold text-[11px] transition shadow-xs"
            >
              <Sparkles className="w-3 h-3 text-[#F59E0B]" />
              <span>Lås upp Pro</span>
            </button>
          )}

        </div>

      </div>
    </header>
  );
};
