# Vakt (`vakt.apps.harkco.se`) 🛡️📡
> **Harkco Fleet Uptime & JSON Error Alerting Service**  
> Lightweight sentinel probing /health on Harkco Daily Apps with millisecond latency sparklines, JSON response inspection, and incident logging.

---

## Capabilities

- **Automatic Fleet Probing**: Periodically probes official `/health` endpoints across all Harkco Daily Apps (`qvitt`, `fakturacraft`, `skattekoll`, `moteskoll`, `brygg`, `styrka`, `akvarium`, `puls`, `knippa`, `knatte`, etc.).
- **Millisecond Latency Sparklines**: Displays 20-probe rolling history bars for instant latency trend detection.
- **Deep JSON Error Extraction**: When a non-200 or timeout occurs, captures the exact JSON error payload or stack trace.
- **Incident Resolution Tracking**: Automatically detects when an endpoint recovers and logs downtime duration.
- **Tactile Nordic Radar Console**: Dark naval steel `#080C14` with pulsing radar emerald `#10B981` indicators and Web Audio sonar pings.
- **Client & Server Integration**: Zero bloated monitoring frameworks. Powered by Node.js 22 native `node:sqlite` and native `node:http`.

---

## Endpoints

- `GET /health` — Service health and fleet summary.
- `GET /api/monitors` — List of all monitored endpoints with recent latency history.
- `POST /api/probe-now` — Triggers an immediate probe across the entire fleet.
- `GET /api/incidents` — Log of recent outages and recovery events.
- `POST /api/monitors` — Add custom HTTP/HTTPS monitor.
- `DELETE /api/monitors/:id` — Remove custom monitor.

---

*Harkco Software Studio — Craft, Utility & Independence.*
