import type { PacketKind } from './trafficVisuals';
import type { PacketView } from './types';
import { normalizePacketKind, PACKET_KINDS } from './trafficVisuals';
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

  constructor(root: HTMLElement, private readonly onSelect: (packet: PacketView) => void) {
    root.hidden = new URLSearchParams(location.search).get('panel') !== 'traces';
    root.replaceChildren();
    const title = document.createElement('h2'); title.textContent = 'Live Traces';
    this.kind.setAttribute('aria-label', 'Traffic kind');
    const all = document.createElement('option'); all.value = ''; all.textContent = 'All kinds'; this.kind.append(all);
    for (const value of PACKET_KINDS) { const option = document.createElement('option'); option.value = value; option.textContent = value; this.kind.append(option); }
    this.pause.type = 'button'; this.pause.textContent = 'Pause list'; this.pause.addEventListener('click', () => { this.paused = !this.paused; this.pause.textContent = this.paused ? 'Resume list' : 'Pause list'; this.render(); });
    this.kind.addEventListener('change', () => this.render());
    const controls = document.createElement('div'); controls.className = 'trace-controls'; controls.append(this.pause, this.kind);
    this.status.className = 'trace-status'; this.list.className = 'trace-list';
    root.append(title, controls, this.status, this.list);
    this.render();
  }

  add(packet: PacketView): void { this.store.add(packet); if (this.paused) { this.pending += 1; this.status.textContent = `${this.pending} new observation${this.pending === 1 ? '' : 's'} · list paused`; } else this.render(); }
  reset(): void { this.store.clear(); this.selected = undefined; this.pending = 0; this.render(); }

  private render(): void {
    const filter = this.kind.value as PacketKind;
    const rows = this.store.all().filter(row => !filter || normalizePacketKind(row.packet.payloadType) === filter).slice(-100).reverse();
    this.status.textContent = `${rows.length} recent observation${rows.length === 1 ? '' : 's'} · last 15 minutes · route data is live only`;
    this.list.replaceChildren();
    for (const row of rows) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'trace-row';
      const kind = normalizePacketKind(row.packet.payloadType);
      const path = row.packet.mode === 'route' ? row.packet.segments.map(segment => `${segment.from.label} → ${segment.to.label}`).join(' · ') : 'Heard here; route unavailable';
      button.textContent = `${new Date(row.packet.at).toLocaleTimeString()} · ${kind} · ${path}`;
      button.addEventListener('click', () => { this.selected = row; this.onSelect(row.packet); this.render(); });
      if (row === this.selected) button.dataset.selected = 'true';
      this.list.append(button);
    }
  }
}
