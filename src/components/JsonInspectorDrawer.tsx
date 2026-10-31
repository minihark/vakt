import React, { useState } from 'react';
import { Monitor } from '../types';
import { X, Copy, Check, Terminal, ExternalLink } from 'lucide-react';
import { playClick } from '../utils/audio';

interface JsonInspectorDrawerProps {
  monitor: Monitor | null;
  onClose: () => void;
}

export const JsonInspectorDrawer: React.FC<JsonInspectorDrawerProps> = ({
  monitor,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);

  if (!monitor) return null;

  let prettyJson = '';
  try {
    if (monitor.lastResponseBody) {
      prettyJson = JSON.stringify(JSON.parse(monitor.lastResponseBody), null, 2);
    } else {
      prettyJson = '// Ingen responsdata tillgänglig än';
    }
  } catch (e) {
    prettyJson = monitor.lastResponseBody || '// Icke-JSON payload mottagen';
  }

  const handleCopy = () => {
    playClick();
    navigator.clipboard.writeText(prettyJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-2xl bg-[#0E1422] border border-[#1A2438] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        
        {/* Header */}
        <div className="p-4 sm:p-5 bg-[#080C14] border-b border-[#1A2438] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#0E1422] border border-[#1A2438] text-[#06B6D4]">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-white">
                  {monitor.name}
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/25">
                  HTTP {monitor.expectedStatus}
                </span>
              </div>
              <a
                href={monitor.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[#64748B] hover:text-[#94A3B8] font-mono flex items-center gap-1 mt-0.5"
              >
                <span>{monitor.url}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#64748B] hover:text-white bg-[#0E1422] hover:bg-[#141C30] border border-[#1A2438] transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Bar */}
        <div className="px-5 py-2.5 bg-[#080C14]/60 border-b border-[#1A2438] flex items-center justify-between text-xs font-mono text-[#94A3B8]">
          <div className="flex items-center gap-4">
            <div>
              Latens: <span className="font-bold text-white">{monitor.lastLatencyMs}ms</span>
            </div>
            <div>
              24h Uptime: <span className="font-bold text-[#10B981]">{monitor.uptime24h}%</span>
            </div>
          </div>
          <div>
            {new Date(monitor.lastCheckedAt).toLocaleTimeString('sv-SE')}
          </div>
        </div>

        {/* JSON Code Viewer */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 font-mono text-xs">
          <div className="relative">
            <button
              type="button"
              onClick={handleCopy}
              className="absolute top-2 right-2 px-2.5 py-1 rounded bg-[#1A2438] hover:bg-[#263552] text-white text-[11px] font-mono flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            >
              {copied ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3 text-[#94A3B8]" />}
              <span>{copied ? 'Kopierat!' : 'Kopiera JSON'}</span>
            </button>

            <pre className="p-4 rounded-xl bg-[#080C14] border border-[#1A2438] text-[#10B981] overflow-x-auto whitespace-pre-wrap leading-relaxed">
              <code>{prettyJson}</code>
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-[#080C14] border-t border-[#1A2438] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-[#141C30] hover:bg-[#1A2438] text-white font-mono text-xs font-bold transition cursor-pointer"
          >
            Stäng
          </button>
        </div>

      </div>
    </div>
  );
};
