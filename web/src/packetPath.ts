import type { PacketView } from './types';

/** Ellipses mark gaps; arrows only join adjacent mapped endpoints. */
export function packetPathLabel(packet: PacketView): string {
  if (packet.path?.length) return packet.path.map((step, i) =>
    `${i ? (step.node && packet.path![i - 1]?.node ? ' → ' : ' … ') : ''}${step.label}`).join('');
  if (packet.mode === 'observer') return `Heard by ${packet.observer.label} · earlier path details not retained`;
  return packet.segments.map(s => `${s.from.label} → ${s.to.label}`).join(' · ');
}
