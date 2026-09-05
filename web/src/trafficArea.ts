import type { EndpointV2, PacketView, RoutePacketView, RouteSegmentView, StateV2 } from './types';

/** A non-wrapping Web Mercator rectangle: [[west, south], [east, north]]. */
export type AreaBounds = [[number, number], [number, number]];

export function parseAreaBounds(raw: unknown): AreaBounds | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.split(',').map((value) => value.trim());
  if (parts.length !== 4 || parts.some((value) => value === '' || !Number.isFinite(Number(value)))) return null;
  const [west, south, east, north] = parts.map(Number) as [number, number, number, number];
  if (west < -180 || east > 180 || west >= east) return null;
  if (south < -85.051129 || north > 85.051129 || south >= north) return null;
  return [[west, south], [east, north]];
}

/** Bounds must come from parseAreaBounds; border points count as inside. */
export function pointInArea(point: Pick<EndpointV2, 'lat' | 'lng'>, area: AreaBounds): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lng)
    && point.lng >= area[0][0] && point.lng <= area[1][0]
    && point.lat >= area[0][1] && point.lat <= area[1][1];
}

/** Display projection only. Keep the full snapshot in LiveStore for SSE recovery. */
export function projectStateToArea(state: Readonly<StateV2>, area: AreaBounds | null): Readonly<StateV2> {
  if (!area) return state;
  const nodes = state.nodes.filter((node) => pointInArea(node, area));
  const ids = new Set(nodes.map((node) => node.id));
  const routes = state.routes.filter((route) => ids.has(route.fromId) && ids.has(route.toId));
  return { ...state, nodes, routes };
}

/** One observation, possibly several local runs; never count runs as new packets. */
export type AreaPacket = Pick<PacketView, 'id' | 'seq' | 'at' | 'payloadType'> & { runs: PacketView[] };

/** Call after LiveStore.applyPacket has processed the complete, sequenced event. */
export function projectPacketToArea(packet: PacketView | null, area: AreaBounds | null): AreaPacket | null {
  if (!packet) return null;
  let runs: PacketView[];
  if (!area) {
    runs = [packet];
  } else if (packet.mode === 'observer') {
    runs = pointInArea(packet.observer, area) ? [packet] : [];
  } else {
    runs = [];
    let current: RoutePacketView | undefined;
    for (const segment of packet.segments) {
      if (!pointInArea(segment.from, area) || !pointInArea(segment.to, area)) {
        current = undefined;
        continue;
      }
      const previous = current?.segments.at(-1);
      if (!previous || !connected(previous, segment)) {
        current = { ...packet, segments: [] };
        runs.push(current);
      }
      current!.segments.push(segment);
    }
  }
  return runs.length ? { id: packet.id, seq: packet.seq, at: packet.at, payloadType: packet.payloadType, runs } : null;
}

function connected(previous: RouteSegmentView, next: RouteSegmentView): boolean {
  return previous.to.id === next.from.id
    && previous.to.lat === next.from.lat && previous.to.lng === next.from.lng;
}
