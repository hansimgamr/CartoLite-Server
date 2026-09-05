import type { PacketView } from './types';

export interface TraceRecord { receivedAt: number; packet: PacketView; }

export class TraceStore {
  private rows: TraceRecord[] = [];
  private readonly maxAge = 15 * 60_000;
  private readonly maxRows = 1_000;

  add(packet: PacketView): void {
    const now = Date.now();
    this.rows.push({ receivedAt: now, packet });
    const cutoff = now - this.maxAge;
    this.rows = this.rows.filter(row => row.receivedAt >= cutoff).slice(-this.maxRows);
  }

  all(): readonly TraceRecord[] { return this.rows; }
  clear(): void { this.rows = []; }
}
