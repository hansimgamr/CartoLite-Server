import type { PacketKind } from './trafficVisuals';
import type { PacketView } from './types';
import { normalizePacketKind, PACKET_KIND_LABELS, PACKET_KINDS } from './trafficVisuals';
import { TraceStore, type TraceRecord } from './traceStore';

export class TraceInspector {
  private readonly store = new TraceStore();
  private paused = false;
  private pending = 0;
  private selected?: TraceRecord;
  private readonly kind = document.createElement('select');
  private readonly list = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly pause = document.createElement('button');
  private readonly exportButton = document.createElement('button');
  private readonly detail = document.createElement('div');
  private readonly liveView = document.createElement('button');
  private readonly logView = document.createElement('button');
  private logMode = false;

  constructor(root: HTMLElement, private readonly onSelect: (packet: PacketView) => void, private readonly onFit: (packet: PacketView) => void, private readonly onReplay: (packet: PacketView) => void) {
    root.hidden = new URLSearchParams(location.search).get('panel') !== 'traces';
    root.replaceChildren();
    const title = document.createElement('h2'); title.textContent = 'Live Traces';
    this.kind.setAttribute('aria-label', 'Traffic kind');
    const all = document.createElement('option'); all.value = ''; all.textContent = 'All kinds'; this.kind.append(all);
    for (const value of PACKET_KINDS) { const option = document.createElement('option'); option.value = value; option.textContent = PACKET_KIND_LABELS[value]; this.kind.append(option); }
    this.pause.type = 'button'; this.pause.textContent = 'Pause list'; this.pause.addEventListener('click', () => { this.paused = !this.paused; this.pause.textContent = this.paused ? 'Resume list' : 'Pause list'; this.render(); });
    this.exportButton.type = 'button'; this.exportButton.textContent = 'Download CSV'; this.exportButton.addEventListener('click', () => this.exportCSV());
    this.kind.addEventListener('change', () => this.render());
    this.liveView.type = 'button'; this.liveView.textContent = 'Live'; this.liveView.setAttribute('aria-pressed', 'true'); this.liveView.addEventListener('click', () => this.setView(false));
    this.logView.type = 'button'; this.logView.textContent = 'Log'; this.logView.setAttribute('aria-pressed', 'false'); this.logView.addEventListener('click', () => this.setView(true));
    const viewToggle = document.createElement('div'); viewToggle.className = 'trace-view-toggle'; viewToggle.setAttribute('aria-label', 'Trace display'); viewToggle.append(this.liveView, this.logView);
    const controls = document.createElement('div'); controls.className = 'trace-controls'; controls.append(viewToggle, this.pause, this.kind, this.exportButton);
    this.status.className = 'trace-status'; this.list.className = 'trace-list';
    this.detail.className = 'trace-status trace-detail'; root.append(title, controls, this.status, this.detail, this.list);
    this.render();
  }

  add(packet: PacketView): void { this.store.add(packet); if (this.paused) { this.pending += 1; this.status.textContent = `${this.pending} new observation${this.pending === 1 ? '' : 's'} · list paused`; } else this.render(); }
  reset(): void { this.store.clear(); this.selected = undefined; this.pending = 0; this.render(); }

  private setView(log: boolean): void {
    this.logMode = log;
    this.liveView.setAttribute('aria-pressed', String(!log));
    this.logView.setAttribute('aria-pressed', String(log));
    this.render();
  }

  private exportCSV(): void {
    const filter = this.kind.value as PacketKind;
    const rows = this.store.all().filter(row => !filter || normalizePacketKind(row.packet.payloadType) === filter);
    const csv = ['time,kind,mode,segments,route', ...rows.map(row => {
      const packet = row.packet;
      const route = packet.mode === 'route' ? packet.segments.map(segment => `${segment.from.label} -> ${segment.to.label}`).join(' | ') : 'Heard here; route unavailable';
      return [new Date(packet.at).toISOString(), PACKET_KIND_LABELS[normalizePacketKind(packet.payloadType)], packet.mode, packet.mode === 'route' ? packet.segments.length : 0, route]
        .map(value => `"${String(value).replaceAll('"', '""')}"`).join(',');
    })].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'cartolite-live-traces.csv'; link.click(); URL.revokeObjectURL(url);
  }

  private render(): void {
    const filter = this.kind.value as PacketKind;
    const retained = this.store.all().filter(row => !filter || normalizePacketKind(row.packet.payloadType) === filter);
    const rows = this.logMode ? [...retained].reverse() : retained.slice(-100).reverse();
    this.status.textContent = this.logMode
      ? `${rows.length} retained observation${rows.length === 1 ? '' : 's'} · last 15 minutes · newest first`
      : `${rows.length} recent observation${rows.length === 1 ? '' : 's'} · last 15 minutes · route data is live only`;
    this.list.classList.toggle('trace-log', this.logMode);
    this.list.replaceChildren();
    for (const row of rows) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'trace-row';
      const kind = normalizePacketKind(row.packet.payloadType);
      const kindLabel = PACKET_KIND_LABELS[kind];
      const path = row.packet.mode === 'route' ? row.packet.segments.map(segment => `${segment.from.label} → ${segment.to.label}`).join(' · ') : 'Heard here; route unavailable';
      if (this.logMode) {
        button.classList.add('trace-log-row');
        const stamp = document.createElement('time'); stamp.dateTime = new Date(row.packet.at).toISOString(); stamp.textContent = new Date(row.packet.at).toLocaleString();
        const meta = document.createElement('span'); meta.className = 'trace-log-meta'; meta.textContent = `${kindLabel} · ${row.packet.mode === 'route' ? `${row.packet.segments.length} hops` : 'observer'}`;
        const route = document.createElement('span'); route.className = 'trace-log-path'; route.textContent = path;
        button.append(stamp, meta, route);
      } else button.textContent = `${new Date(row.packet.at).toLocaleTimeString()} · ${kindLabel} · ${path}`;
      button.addEventListener('click', () => { this.selected = row; this.onSelect(row.packet); this.render(); void this.loadRouteHistory(row.packet); });
      if (row === this.selected) button.dataset.selected = 'true';
      this.list.append(button);
    }
  }

  private async loadRouteHistory(packet: PacketView): Promise<void> {
    if (packet.mode !== 'route' || packet.segments.length === 0) { this.detail.textContent = packet.mode === 'observer' ? 'Heard here; route unavailable.' : ''; return; }
    const ids = [...new Set(packet.segments.map(segment => segment.routeId))].slice(0, 25);
    this.detail.replaceChildren();
    const actions = document.createElement('span');
    const fit = document.createElement('button'); fit.type = 'button'; fit.textContent = 'Fit route'; fit.addEventListener('click', () => this.onFit(packet));
    const replay = document.createElement('button'); replay.type = 'button'; replay.textContent = 'Replay (illustrative)'; replay.title = 'Visual replay only; not measured radio timing'; replay.addEventListener('click', () => this.onReplay(packet));
    actions.append(fit, replay); this.detail.append(actions, document.createTextNode(' Loading retained route activity…'));
    try {
      const response = await fetch(`/api/route-history?routes=${ids.join(',')}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('history unavailable');
      const body = await response.json() as { routes?: Record<string, number[]>; partial?: boolean };
      if (this.selected?.packet !== packet) return;
      const count = ids.reduce((total, id) => total + (body.routes?.[id]?.length || 0), 0);
      const summary = document.createElement('span'); summary.textContent = ` · ${count} retained observations across ${ids.length} mapped segment${ids.length === 1 ? '' : 's'} · last 7 days${body.partial ? ' · partial' : ''}`;
      this.detail.replaceChildren(actions, summary);
      const times = ids.flatMap(id => body.routes?.[id] || []).filter(Number.isFinite).sort((a, b) => b - a).slice(0, 20);
      if (times.length) {
        const history = document.createElement('div'); history.className = 'trace-history-log';
        const heading = document.createElement('strong'); heading.textContent = 'Historical segment observations'; history.append(heading);
        times.forEach((timestamp) => { const entry = document.createElement('time'); entry.dateTime = new Date(timestamp).toISOString(); entry.textContent = new Date(timestamp).toLocaleString(); history.append(entry); });
        this.detail.append(history);
      }
    } catch { this.detail.textContent = 'Historical route activity is temporarily unavailable.'; }
  }
}
