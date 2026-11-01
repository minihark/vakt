import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Monitor, Incident, FleetStats } from './types';
import { Navbar } from './components/Navbar';
import { StatusHero } from './components/StatusHero';
import { MonitorCard } from './components/MonitorCard';
import { JsonInspectorDrawer } from './components/JsonInspectorDrawer';
import { AddMonitorModal } from './components/AddMonitorModal';
import { ProUpgradeModal } from './components/ProUpgradeModal';
import { AlertSettingsDrawer } from './components/AlertSettingsDrawer';
import { BadgeEmbedModal } from './components/BadgeEmbedModal';
import { playSonarPing, playIncidentAlarm, setAudioMuted } from './utils/audio';
import { History } from 'lucide-react';

export const App: React.FC = () => {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isProbing, setIsProbing] = useState<boolean>(false);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isPro, setIsPro] = useState<boolean>(() => {
    return localStorage.getItem('vakt_pro') === 'true';
  });

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isAlertsDrawerOpen, setIsAlertsDrawerOpen] = useState(false);
  const [isBadgeModalOpen, setIsBadgeModalOpen] = useState(false);
  const [badgeTargetId, setBadgeTargetId] = useState<string | undefined>('fleet');
  const [isProModalOpen, setIsProModalOpen] = useState(false);
  const [inspectorMonitor, setInspectorMonitor] = useState<Monitor | null>(null);

  // Fetch Monitors & History
  const fetchMonitors = useCallback(async () => {
    try {
      const res = await fetch('/api/monitors');
      if (res.ok) {
        const data = await res.json();
        setMonitors(data);
      }
    } catch (e) {
      console.error('Failed to fetch monitors:', e);
    }
  }, []);

  // Fetch Incidents
  const fetchIncidents = useCallback(async () => {
    try {
      const res = await fetch('/api/incidents');
      if (res.ok) {
        const data = await res.json();
        setIncidents(data);
      }
    } catch (e) {
      console.error('Failed to fetch incidents:', e);
    }
  }, []);

  useEffect(() => {
    fetchMonitors();
    fetchIncidents();
    const interval = setInterval(() => {
      fetchMonitors();
      fetchIncidents();
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchMonitors, fetchIncidents]);

  // Compute Fleet Stats
  const fleetStats: FleetStats = useMemo(() => {
    const total = monitors.length;
    let upCount = 0;
    let totalLatency = 0;
    let totalUptimeSum = 0;

    monitors.forEach((m) => {
      if (m.currentStatus === 'up') upCount++;
      totalLatency += m.lastLatencyMs;
      totalUptimeSum += m.uptime24h;
    });

    const averageLatencyMs = total > 0 ? Math.round(totalLatency / total) : 0;
    const overallUptimePercent = total > 0 ? Math.round((totalUptimeSum / total) * 100) / 100 : 100;
    const incidentCount = total - upCount;

    return {
      totalMonitors: total,
      operationalCount: upCount,
      incidentCount,
      averageLatencyMs,
      overallUptimePercent,
      lastGlobalProbe: monitors[0]?.lastCheckedAt || new Date().toISOString(),
    };
  }, [monitors]);

  // Trigger Immediate Fleet Probe
  const handleProbeNow = async () => {
    setIsProbing(true);
    playSonarPing();
    try {
      const res = await fetch('/api/probe-now', { method: 'POST' });
      if (res.ok) {
        await fetchMonitors();
        await fetchIncidents();
        if (fleetStats.incidentCount > 0) {
          playIncidentAlarm();
        }
      }
    } catch (e) {
      console.error('Probe failed:', e);
    } finally {
      setIsProbing(false);
    }
  };

  // Add Custom Monitor
  const handleAddMonitor = async (name: string, url: string) => {
    const res = await fetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Kunde inte lägga till monitor');
    }

    await fetchMonitors();
  };

  // Delete Custom Monitor
  const handleDeleteMonitor = async (id: string) => {
    try {
      const res = await fetch(`/api/monitors/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMonitors((prev) => prev.filter((m) => m.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete monitor:', e);
    }
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    setAudioMuted(next);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#080C14] text-[#F1F5F9] font-sans selection:bg-[#10B981] selection:text-black">
      
      {/* 2px Radar Accent Line */}
      <div className="h-0.5 w-full bg-gradient-to-r from-[#10B981] via-[#06B6D4] to-[#F59E0B]" />

      {/* Navigation */}
      <Navbar
        isMuted={isMuted}
        onToggleMute={handleToggleMute}
        onOpenAddModal={() => setIsAddModalOpen(true)}
        onOpenAlertsDrawer={() => setIsAlertsDrawerOpen(true)}
        onOpenBadgeModal={() => {
          setBadgeTargetId('fleet');
          setIsBadgeModalOpen(true);
        }}
        onOpenProModal={() => setIsProModalOpen(true)}
        isPro={isPro}
        incidentCount={fleetStats.incidentCount}
      />

      {/* Main Radar Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
        
        {/* Status Hero Banner */}
        <StatusHero
          stats={fleetStats}
          isProbing={isProbing}
          onProbeNow={handleProbeNow}
        />

        {/* Harkco Daily Apps Monitor Grid */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-xl font-bold tracking-tight text-white">
                Harkco Daily Apps Flotta
              </h2>
              <p className="text-xs text-[#64748B] font-mono">
                Realtidsprobning av officiella /health endpoints i OrbStack & Coolify
              </p>
            </div>
            <span className="text-xs font-mono px-2.5 py-1 rounded bg-[#0E1422] border border-[#1A2438] text-[#10B981]">
              {monitors.length} aktiva probpunkter
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {monitors.map((monitor) => (
              <MonitorCard
                key={monitor.id}
                monitor={monitor}
                onInspectJson={setInspectorMonitor}
                onOpenBadgeModal={(id) => {
                  setBadgeTargetId(id);
                  setIsBadgeModalOpen(true);
                }}
                onDeleteMonitor={handleDeleteMonitor}
              />
            ))}
          </div>
        </div>

        {/* Recent Incidents Log */}
        {incidents.length > 0 && (
          <div className="p-5 rounded-2xl bg-[#0E1422] border border-[#1A2438] space-y-3">
            <div className="flex items-center gap-2 text-sm font-bold text-white font-mono">
              <History className="w-4 h-4 text-[#F59E0B]" />
              <span>Loggade Incidenter & Återhämtningar ({incidents.length})</span>
            </div>

            <div className="space-y-2">
              {incidents.slice(0, 6).map((inc) => (
                <div
                  key={inc.id}
                  className="p-3 rounded-xl bg-[#080C14] border border-[#1A2438] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={`w-2 h-2 rounded-full ${inc.resolvedAt ? 'bg-[#10B981]' : 'bg-[#EF4444] animate-ping'}`} />
                    <span className="font-bold text-white">{inc.monitorName}</span>
                    <span className="text-[#64748B] truncate max-w-xs">{inc.errorMessage}</span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-[#64748B]">
                    <span>{new Date(inc.startedAt).toLocaleTimeString('sv-SE')}</span>
                    {inc.resolvedAt ? (
                      <span className="text-[#10B981] font-bold">Löst efter {inc.durationSec}s</span>
                    ) : (
                      <span className="text-[#EF4444] font-bold">Pågående</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* JSON Inspector Drawer */}
      <JsonInspectorDrawer
        monitor={inspectorMonitor}
        onClose={() => setInspectorMonitor(null)}
      />

      {/* Alert Settings Drawer */}
      <AlertSettingsDrawer
        isOpen={isAlertsDrawerOpen}
        onClose={() => setIsAlertsDrawerOpen(false)}
      />

      {/* Public Status Shield Badges Modal */}
      <BadgeEmbedModal
        isOpen={isBadgeModalOpen}
        onClose={() => setIsBadgeModalOpen(false)}
        monitors={monitors}
        initialMonitorId={badgeTargetId}
      />

      {/* Add Monitor Modal */}
      <AddMonitorModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAddMonitor={handleAddMonitor}
      />

      {/* Pro Modal */}
      <ProUpgradeModal
        isOpen={isProModalOpen}
        onClose={() => setIsProModalOpen(false)}
        onUpgradeSuccess={() => setIsPro(true)}
        isPro={isPro}
      />

      {/* Footer */}
      <footer className="border-t border-[#1A2438] bg-[#080C14] py-6 px-4 sm:px-6 text-xs text-[#64748B] font-mono mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="font-bold text-white">Vakt</span>
            <span>•</span>
            <a
              href="https://vakt.apps.harkco.se"
              title="Harkco Fleet Status Sentinel"
              className="inline-block hover:opacity-90 transition-opacity"
            >
              <img
                src="https://vakt.apps.harkco.se/badge/fleet.svg"
                alt="Harkco Fleet: operational"
                height="20"
                className="h-5 inline-block"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </a>
            <span>•</span>
            <span className="text-[#10B981]">100% Noll Annonser</span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[#94A3B8]">
            <a href="https://qvitt.se" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Qvitt</a>
            <a href="https://fakturacraft.apps.harkco.se" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">FakturaCraft</a>
            <a href="https://skattekoll.apps.harkco.se" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">SkatteKoll</a>
            <a href="https://moteskoll.apps.harkco.se" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">MötesKoll</a>
            <a href="https://puls.apps.harkco.se" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Puls</a>
            <a href="https://knippa.apps.harkco.se" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Knippa</a>
            <a href="https://apps.harkco.se" target="_blank" rel="noopener noreferrer" className="hover:text-white transition">Alla Appar ↗</a>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default App;
