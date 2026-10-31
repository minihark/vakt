import React, { useState } from 'react';
import confetti from 'canvas-confetti';
import { X, Sparkles, Check, ArrowRight, Smartphone, CreditCard } from 'lucide-react';
import { playClick } from '../utils/audio';

interface ProUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: () => void;
  isPro: boolean;
}

export const ProUpgradeModal: React.FC<ProUpgradeModalProps> = ({
  isOpen,
  onClose,
  onUpgradeSuccess,
}) => {
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseError, setLicenseError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<'swish' | 'card'>('swish');

  if (!isOpen) return null;

  const triggerConfetti = () => {
    confetti({
      particleCount: 120,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#10B981', '#06B6D4', '#F59E0B'],
    });
  };

  const handleSimulatedPayment = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      triggerConfetti();
      localStorage.setItem('vakt_pro', 'true');
      localStorage.setItem('vakt_pro_key', 'HARKCO-VAKT-PRO-LIFETIME');
      onUpgradeSuccess();
    }, 1000);
  };

  const handleApplyKey = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = licenseKey.trim().toUpperCase();
    if (!cleanKey) return;

    if (cleanKey.includes('VAKT') || cleanKey.startsWith('HARKCO') || cleanKey.length >= 8) {
      setLicenseError('');
      triggerConfetti();
      localStorage.setItem('vakt_pro', 'true');
      localStorage.setItem('vakt_pro_key', cleanKey);
      onUpgradeSuccess();
    } else {
      setLicenseError('Ogiltig licensnyckel. Testa t.ex. "HARKCO-VAKT-2026"');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-lg bg-[#0E1422] border border-[#1A2438] rounded-2xl shadow-2xl overflow-hidden text-white">
        
        {/* Banner */}
        <div className="bg-[#080C14] p-6 border-b border-[#1A2438] relative">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg border border-[#1A2438] bg-[#0E1422] hover:bg-[#141C30] text-[#64748B] hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#10B981]/10 border border-[#10B981]/30 text-[#10B981] text-xs font-mono font-bold uppercase tracking-wider mb-2">
            <Sparkles className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>Engångsköp • 149 kr</span>
          </div>

          <h2 className="font-serif text-2xl font-bold tracking-tight text-white">
            Vakt Pro Sentinel
          </h2>
          <p className="text-xs text-[#94A3B8] mt-1 max-w-sm">
            Utökad övervakning för team och frilansare. 100% fri från återkommande prenumerationer och annonser.
          </p>
        </div>

        {/* Features */}
        <div className="p-6 space-y-5 bg-[#0E1422]">
          <ul className="space-y-2.5 text-xs text-[#F1F5F9] font-sans">
            <li className="flex items-center gap-2.5">
              <div className="w-4 h-4 rounded-full bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center text-[#10B981]">
                <Check className="w-3 h-3" />
              </div>
              <span><strong>Omedelbara E-post & Webhook-larm</strong> vid driftstörning (Resend / Slack)</span>
            </li>
            <li className="flex items-center gap-2.5">
              <div className="w-4 h-4 rounded-full bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center text-[#10B981]">
                <Check className="w-3 h-3" />
              </div>
              <span><strong>10-sekunders högfrekvent probning</strong> för verksamhetskritiska servrar</span>
            </li>
            <li className="flex items-center gap-2.5">
              <div className="w-4 h-4 rounded-full bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center text-[#10B981]">
                <Check className="w-3 h-3" />
              </div>
              <span><strong>Obegränsade monitorer</strong> med historiska SLA-månadsrapporter</span>
            </li>
            <li className="flex items-center gap-2.5">
              <div className="w-4 h-4 rounded-full bg-[#10B981]/15 border border-[#10B981]/30 flex items-center justify-center text-[#10B981]">
                <Check className="w-3 h-3" />
              </div>
              <span><strong>Exakt JSON-felinspektion</strong> & automatisk återställningsverifiering</span>
            </li>
          </ul>

          {/* Payment Method Switcher */}
          <div className="pt-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  playClick();
                  setSelectedMethod('swish');
                }}
                className={`flex-1 py-2 px-3 rounded-lg border text-xs font-mono font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                  selectedMethod === 'swish'
                    ? 'border-[#10B981] bg-[#10B981]/10 text-[#10B981]'
                    : 'border-[#1A2438] bg-[#080C14] text-[#64748B]'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                <span>Swish (149 kr)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  playClick();
                  setSelectedMethod('card');
                }}
                className={`flex-1 py-2 px-3 rounded-lg border text-xs font-mono font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                  selectedMethod === 'card'
                    ? 'border-[#10B981] bg-[#10B981]/10 text-[#10B981]'
                    : 'border-[#1A2438] bg-[#080C14] text-[#64748B]'
                }`}
              >
                <CreditCard className="w-4 h-4" />
                <span>Kortbetalning</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleSimulatedPayment}
              disabled={isProcessing}
              className="w-full mt-3 py-2.5 px-4 rounded-lg bg-[#10B981] hover:bg-[#059669] text-black font-mono font-bold text-xs flex items-center justify-center gap-2 shadow-radar transition cursor-pointer disabled:opacity-60"
            >
              {isProcessing ? (
                <span>Aktiverar Pro-licens...</span>
              ) : (
                <>
                  <span>Lås upp livstidslicens (149 kr)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>

          {/* License Key */}
          <form onSubmit={handleApplyKey} className="pt-3 border-t border-[#1A2438] space-y-2">
            <div className="text-[11px] font-mono text-[#64748B]">
              Har du redan en licensnyckel?
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="T.ex. HARKCO-VAKT-2026"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg border border-[#1A2438] bg-[#080C14] text-xs font-mono text-white focus:outline-none focus:border-[#10B981]"
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg bg-[#141C30] hover:bg-[#1A2438] text-white text-xs font-mono font-bold transition cursor-pointer"
              >
                Aktivera
              </button>
            </div>
            {licenseError && (
              <p className="text-[11px] font-mono text-[#EF4444]">{licenseError}</p>
            )}
          </form>

        </div>

      </div>
    </div>
  );
};
