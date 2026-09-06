import { packetPathLabel } from './packetPath';
import type { PacketKind } from './trafficVisuals';
import type { PacketView } from './types';
import { normalizePacketKind, PACKET_KIND_LABELS, PACKET_KINDS, PACKET_KIND_COLORS } from './trafficVisuals';
import { TraceStore, type TraceRecord } from './traceStore';

function radioLabel(packet: PacketView): string {
  const parts = [];
  if (packet.rssi !== undefined) parts.push(`RSSI ${packet.rssi} dBm`);
  if (packet.snr !== undefined) parts.push(`SNR ${packet.snr} dB`);
  return parts.join(' · ') || 'Radio readings not supplied';
}

function companionName(packet: PacketView): string {
  const endpoint = packet.mode === 'observer' ? packet.observer : packet.segments[0]?.from;
  return endpoint?.role === 'companion' ? endpoint.label : '';
}

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
  private logMode = true;
  private visibleRows = 200;
  private readonly historyState = document.createElement('p');
  private readonly more = document.createElement('button');
  private readonly ticker = document.getElementById('packet-ticker')!;
  private connected = false;
  private latest?: PacketView;
  private historyLoading?: Promise<void>;


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
    this.liveView.type = 'button'; this.liveView.textContent = 'Live'; this.liveView.setAttribute('aria-pressed', 'false'); this.liveView.addEventListener('click', () => this.setView(false));
    this.logView.type = 'button'; this.logView.textContent = 'Log'; this.logView.setAttribute('aria-pressed', 'true'); this.logView.addEventListener('click', () => this.setView(true));
    const viewToggle = document.createElement('div'); viewToggle.className = 'trace-view-toggle'; viewToggle.setAttribute('aria-label', 'Trace display'); viewToggle.append(this.liveView, this.logView);
    const controls = document.createElement('div'); controls.className = 'trace-controls'; controls.append(viewToggle, this.pause, this.kind, this.exportButton);
    this.status.className = 'trace-status'; this.list.className = 'trace-list';
    this.detail.className = 'trace-status trace-detail'; root.append(title, controls, this.status, this.detail, this.list);
    this.historyState.className = 'trace-status';
    this.more.type = 'button'; this.more.textContent = 'Show older observations'; this.more.className = 'trace-more';
    this.more.addEventListener('click', () => { this.visibleRows += 200; this.render(); });
    root.append(this.more, this.historyState);
    window.setInterval(() => this.renderTicker(), 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void this.restore(); });
    this.renderTicker();
    this.render();
    void this.restore();
  }

  add(packet: PacketView): void { this.store.add(packet); if (!this.latest || packet.at >= this.latest.at) this.latest = packet; this.renderTicker(); if (this.paused) { this.pending += 1; this.status.textContent = `${this.pending} new observation${this.pending === 1 ? '' : 's'} · list paused`; } else this.render(); }
  setConnection(connected: boolean): void { this.connected = connected; this.renderTicker(); }

  restore(): Promise<void> {
    if (this.historyLoading) return this.historyLoading;
    this.historyState.textContent = 'Loading saved observations…';
    this.historyLoading = (async () => {
      try {
        const response = await fetch('/api/packet-history', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('History unavailable');
        const body = await response.json();
        if (body.schemaVersion !== 2 || !Array.isArray(body.packets)) throw new Error('Invalid history');
        this.store.merge(body.packets);
        this.latest = this.store.all().at(-1)?.packet ?? this.latest;
        this.historyState.textContent = 'Saved on the server · up to 7 days / 10,000 observations · includes traffic while you were away';
        if (!this.paused) this.render();
        this.renderTicker();
      } catch {
        this.historyState.textContent = 'Saved history unavailable — current observations are still kept. Retry by returning to this page.';
      } finally { this.historyLoading = undefined; }
    })();
    return this.historyLoading;
  }

  private renderTicker(): void {
    const packets = this.store.all().map(row => row.packet).slice(-24);
    const latest = packets.at(-1);
    const previousChat = this.ticker.querySelector('.packet-chat') as HTMLElement | null;
    const wasLive = !previousChat || previousChat.scrollHeight - previousChat.scrollTop - previousChat.clientHeight < 8;
    const previousTop = previousChat?.scrollTop ?? 0;
    const heading = document.createElement('strong'); heading.textContent = this.connected ? '● Live packet chat · connected' : '○ Live packet chat · reconnecting';
    const live = document.createElement('button'); live.type = 'button'; live.className = 'packet-chat-live'; live.textContent = 'Go to live'; live.title = 'Jump to the newest packet'; live.setAttribute('aria-label', 'Go to live, newest packet'); live.disabled = wasLive;
    const header = document.createElement('div'); header.className = 'packet-chat-header'; header.append(heading, live);
    const chat = document.createElement('div'); chat.className = 'packet-chat'; chat.setAttribute('role', 'log'); chat.setAttribute('aria-live', 'polite');
    live.addEventListener('click', () => { chat.scrollTop = chat.scrollHeight; });
    for (const packet of packets) {
      const kind = normalizePacketKind(packet.payloadType);
      const message = document.createElement('div'); message.className = 'packet-chat-message'; message.style.setProperty('--packet-color', PACKET_KIND_COLORS[kind]);
      const time = document.createElement('time'); time.dateTime = new Date(packet.at).toISOString(); time.textContent = new Date(packet.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      const body = document.createElement('span'); body.textContent = `${PACKET_KIND_LABELS[kind]} · ${packet.partial ? 'Partial · ' : ''}${packetPathLabel(packet)}`;
      message.append(time, body); chat.append(message);
    }
    const signal = document.createElement('small');
    if (latest) {
      const age = Math.max(0, Math.floor((Date.now() - latest.at) / 1000));
      const ago = age < 60 ? `${age}s ago` : age < 3600 ? `${Math.floor(age / 60)}m ago` : `${Math.floor(age / 3600)}h ago`;
      signal.textContent = `Latest ${ago} · ${radioLabel(latest)}`;
      signal.title = new Date(latest.at).toLocaleString();
    } else signal.textContent = 'Waiting for an observation';
    this.ticker.replaceChildren(header, chat, signal);
    chat.scrollTop = wasLive ? chat.scrollHeight : previousTop;
  }

  private setView(log: boolean): void {
    this.logMode = log; this.visibleRows = 200;
    this.liveView.setAttribute('aria-pressed', String(!log));
    this.logView.setAttribute('aria-pressed', String(log));
    this.render();
  }

  private exportCSV(): void {
    const filter = this.kind.value as PacketKind;
    const rows = this.store.all().filter(row => !filter || normalizePacketKind(row.packet.payloadType) === filter);
    const csv = ['time,kind,mode,segments,route,rssi_dbm,snr_db', ...rows.map(row => {
      const packet = row.packet;
      const route = packetPathLabel(packet);
      return [new Date(packet.at).toISOString(), PACKET_KIND_LABELS[normalizePacketKind(packet.payloadType)], packet.mode, packet.mode === 'route' ? packet.segments.length : 0, route, packet.rssi ?? '', packet.snr ?? '']
        .map(value => `"${String(value).replaceAll('"', '""')}"`).join(',');
    })].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'cartolite-live-traces.csv'; link.click(); URL.revokeObjectURL(url);
  }

  private render(): void {
    const filter = this.kind.value as PacketKind;
    const retained = this.store.all().filter(row => !filter || normalizePacketKind(row.packet.payloadType) === filter);
    const rows = this.logMode ? retained.slice(-this.visibleRows).reverse() : retained.filter(row => row.packet.at >= Date.now() - 15 * 60_000).slice(-100).reverse();
    this.more.hidden = !this.logMode || rows.length >= retained.length;
    this.status.textContent = this.logMode
      ? `${rows.length} of ${retained.length} saved observations · newest first`
      : `${rows.length} recent observation${rows.length === 1 ? '' : 's'} · last 15 minutes · older observations in Log`;
    this.list.classList.toggle('trace-log', this.logMode);
    this.list.replaceChildren();
    for (const row of rows) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'trace-row';
      const kind = normalizePacketKind(row.packet.payloadType);
      button.style.setProperty('--packet-color', PACKET_KIND_COLORS[kind]);
      const companion = kind === 'Other' ? companionName(row.packet) : '';
      const kindLabel = companion ? `${PACKET_KIND_LABELS[kind]} · Companion: ${companion}` : PACKET_KIND_LABELS[kind];
      const path = packetPathLabel(row.packet);
      if (this.logMode) {
        button.classList.add('trace-log-row');
        const stamp = document.createElement('time'); stamp.dateTime = new Date(row.packet.at).toISOString(); stamp.textContent = new Date(row.packet.at).toLocaleString();
        const meta = document.createElement('span'); meta.className = 'trace-log-meta'; meta.textContent = `${kindLabel} · ${row.packet.partial ? 'Partial path · ' : ''}${row.packet.mode === 'route' ? `${row.packet.segments.length} mapped links` : 'known receiver'}`;
        const route = document.createElement('span'); route.className = 'trace-log-path'; route.textContent = `${path} · ${radioLabel(row.packet)}`;
        button.append(stamp, meta, route);
      } else button.textContent = `${new Date(row.packet.at).toLocaleTimeString()} · ${kindLabel} · ${path} · ${radioLabel(row.packet)}`;
      button.addEventListener('click', () => { this.selected = row; this.onSelect(row.packet); this.render(); void this.loadRouteHistory(row.packet); });
      if (row === this.selected) button.dataset.selected = 'true';
      this.list.append(button);
    }
  }

  private async loadRouteHistory(packet: PacketView): Promise<void> {
    if (packet.mode !== 'route' || packet.segments.length === 0) {
      const fit = document.createElement('button'); fit.type = 'button'; fit.textContent = 'Show known nodes'; fit.addEventListener('click', () => this.onFit(packet));
      const note = document.createElement('span'); note.textContent = packet.path?.length ? 'Partial path: gaps are unresolved; no link is drawn across them.' : 'Only the receiving node was retained for this earlier observation.';
      this.detail.replaceChildren(fit, note); return;
    }
    const ids = [...new Set(packet.segments.map(segment => segment.routeId))].slice(0, 25);
    this.detail.replaceChildren();
    const actions = document.createElement('span');
    const fit = document.createElement('button'); fit.type = 'button'; fit.textContent = packet.partial ? 'Show known path' : 'Fit route'; fit.addEventListener('click', () => this.onFit(packet));
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
        const note = document.createElement('span'); note.className = 'trace-history-note'; note.textContent = 'Each timestamp marks when CartoLite observed a packet on this route segment.'; history.append(note);
        times.forEach((timestamp) => {
          const row = document.createElement('div'); row.className = 'trace-history-row';
          const event = document.createElement('span'); event.className = 'trace-history-event'; event.textContent = 'Packet observed';
          const entry = document.createElement('time'); entry.dateTime = new Date(timestamp).toISOString(); entry.textContent = new Date(timestamp).toLocaleString();
          row.append(event, entry); history.append(row);
        });
        this.detail.append(history);
      }
    } catch { this.detail.textContent = 'Historical route activity is temporarily unavailable.'; }
  }
}
