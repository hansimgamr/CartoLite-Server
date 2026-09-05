import type { EndpointV2, PacketView } from './types';
import { PACKET_KINDS } from './trafficVisuals';

export interface TraceRecord { receivedAt: number; packet: PacketView; }
export const TRACE_MAX_ROWS = 10_000;
export const TRACE_MAX_AGE = 7 * 24 * 60 * 60_000;

export function isTracePacket(value: unknown): value is PacketView {
  if (!value || typeof value !== 'object') return false;
  const p = value as PacketView;
  const endpoint = (e: EndpointV2): boolean => !!e && typeof e.id === 'string' && typeof e.label === 'string'
    && e.label.length <= 100 && Number.isFinite(e.lat) && Math.abs(e.lat) <= 90 && Number.isFinite(e.lng) && Math.abs(e.lng) <= 180;
  if (typeof p.id !== 'string' || !p.id || !Number.isFinite(p.at) || !Number.isSafeInteger(p.seq) || !PACKET_KINDS.includes(p.payloadType)) return false;
  if (p.rssi !== undefined && (!Number.isFinite(p.rssi) || p.rssi < -200 || p.rssi > 0)) return false;
  if (p.snr !== undefined && (!Number.isFinite(p.snr) || Math.abs(p.snr) > 100)) return false;
  return p.mode === 'observer' ? endpoint(p.observer) : p.mode === 'route' && Array.isArray(p.segments)
    && p.segments.length > 0 && p.segments.length <= 256 && p.segments.every(s => s && typeof s.routeId === 'string' && endpoint(s.from) && endpoint(s.to));
}

export class TraceStore {
  private rows: TraceRecord[] = [];
  add(packet: PacketView): void { this.merge([packet]); }
  merge(packets: readonly unknown[]): void {
    const cutoff = Date.now() - TRACE_MAX_AGE;
    const unique = new Map(this.rows.map(row => [row.packet.id, row]));
    for (const packet of packets) {
      if (isTracePacket(packet) && packet.at >= cutoff && !unique.has(packet.id)) unique.set(packet.id, { receivedAt: packet.at, packet });
    }
    this.rows = [...unique.values()].filter(row => row.packet.at >= cutoff)
      .sort((a, b) => a.packet.at - b.packet.at || a.packet.seq - b.packet.seq).slice(-TRACE_MAX_ROWS);
  }
  all(): readonly TraceRecord[] { return this.rows; }
}
