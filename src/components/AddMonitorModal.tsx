import React, { useState } from 'react';
import { X, Plus, Globe } from 'lucide-react';
import { playClick } from '../utils/audio';

interface AddMonitorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddMonitor: (name: string, url: string) => Promise<void>;
}

export const AddMonitorModal: React.FC<AddMonitorModalProps> = ({
  isOpen,
  onClose,
  onAddMonitor,
}) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !url.trim()) {
      setError('Namn och fullständig URL krävs');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setError('URL måste börja med http:// eller https://');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      playClick();
      await onAddMonitor(name.trim(), url.trim());
      setName('');
      setUrl('');
      onClose();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Kunde inte lägga till monitor';
      setError(errorMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-[#0E1422] border border-[#1A2438] rounded-2xl shadow-2xl overflow-hidden p-6 text-white">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#1A2438]">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-[#10B981]/10 text-[#10B981]">
              <Globe className="w-4 h-4" />
            </div>
            <h3 className="font-bold text-base">Lägg till ny HTTP/HTTPS Monitor</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#64748B] hover:text-white transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div>
            <label className="block text-xs font-mono text-[#94A3B8] mb-1">
              Tjänstens Namn
            </label>
            <input
              type="text"
              required
              placeholder="T.ex. Min E-handel API"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#080C14] border border-[#1A2438] text-white font-mono text-sm focus:outline-none focus:border-[#10B981] transition"
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-[#94A3B8] mb-1">
              Endpoint URL (ska returnera HTTP 200)
            </label>
            <input
              type="url"
              required
              placeholder="https://api.mittbolag.se/health"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#080C14] border border-[#1A2438] text-white font-mono text-sm focus:outline-none focus:border-[#10B981] transition"
            />
          </div>

          {error && (
            <p className="text-xs font-mono text-[#EF4444] bg-[#EF4444]/10 p-2 rounded-lg border border-[#EF4444]/20">
              {error}
            </p>
          )}

          <div className="pt-2 flex justify-end gap-2 font-mono text-xs">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#141C30] hover:bg-[#1A2438] text-[#94A3B8] font-bold transition cursor-pointer"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-[#10B981] hover:bg-[#059669] text-black font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Sparar...' : 'Lägg till & Proba'}</span>
            </button>
          </div>
        </form>

      </div>
    </div>
  );
};
