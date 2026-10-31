export interface ProbeResult {
  statusCode: number;
  latencyMs: number;
  isUp: boolean;
  checkedAt: string;
  responseBody?: string;
  error?: string;
}

export interface Monitor {
  id: string;
  name: string;
  url: string;
  group: 'Harkco Suite' | 'Custom';
  expectedStatus: number;
  currentStatus: 'up' | 'degraded' | 'down';
  lastLatencyMs: number;
  uptime24h: number;
  history: ProbeResult[];
  lastCheckedAt: string;
  lastResponseBody: string | null;
}

export interface Incident {
  id: string;
  monitorId: string;
  monitorName: string;
  url: string;
  statusCode: number;
  errorMessage: string;
  errorPayload: string;
  startedAt: string;
  resolvedAt: string | null;
  durationSec: number | null;
}

export interface FleetStats {
  totalMonitors: number;
  operationalCount: number;
  incidentCount: number;
  averageLatencyMs: number;
  overallUptimePercent: number;
  lastGlobalProbe: string;
}

export interface AlertSettings {
  webhookUrl: string;
  alertEmail: string;
  resendApiKeyConfigured: boolean;
  notifyOnDown: boolean;
  notifyOnRecovery: boolean;
}

export interface AlertLog {
  id: string;
  event: string;
  monitor_name: string;
  channel: string;
  status: string;
  details: string | null;
  dispatched_at: string;
}
