import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertStateV2, LiveStore, ROUTE_BATCH_MS, sequenceAction } from './state';
import { parseAreaBounds, pointInArea, projectPacketToArea, projectStateToArea, scopedMapChanges, type AreaBounds } from './trafficArea';
import type { NodeV2, PacketEventV2, RoutePacketView, RouteSegmentView, RouteV2, StateV2 } from './types';

// Entirely synthetic topology; no live nodes or broker data.
const area: AreaBounds = [[10, 20], [12, 22]];
const a = node('a', 10.25), b = node('b', 10.75), c = node('c', 11.25), d = node('d', 11.75);
const west = node('west', 9), east = node('east', 13);
const initial: StateV2 = {
  schemaVersion: 2, bootId: 'synthetic', seq: 7, serverTime: 100,
  status: { feed: 'connected', activity: 'active', lastPacketAt: 100, dropped: 0, version: 'test', gitSha: 'test' },
  map: { center: [0, 20], zoom: 1.4 },
  nodes: [a, b, c, d, west, east],
  routes: [route(a, b), route(b, west), route(west, east), route(c, d)]
};

afterEach(() => vi.useRealTimers());

describe('area validation and containment', () => {
  it('parses geographic bounds and rejects incomplete, reversed and unrenderable areas', () => {
    expect(parseAreaBounds(' 10 , 20 , 12 , 22 ')).toEqual(area);
    for (const invalid of [undefined, null, [], '', '10,,12,22', '10,20,12, ', '10,20,12',
      '12,20,10,22', '10,22,12,20', '10,20,10,22', '10,20,12,20',
      '-181,20,12,22', '10,20,181,22', '10,-86,12,22', '10,20,12,86',
      '10,20,NaN,22', '10,20,Infinity,22', '170,20,-170,22']) {
      expect(parseAreaBounds(invalid)).toBeNull();
    }
  });

  it('includes every edge/corner and excludes invalid or just-outside coordinates', () => {
    for (const lat of [20, 21, 22]) {
      for (const lng of [10, 11, 12]) expect(pointInArea({ lat, lng }, area)).toBe(true);
    }
    for (const point of [{ lat: 19.999, lng: 11 }, { lat: 22.001, lng: 11 },
      { lat: 21, lng: 9.999 }, { lat: 21, lng: 12.001 },
      { lat: NaN, lng: 11 }, { lat: 21, lng: Infinity }]) {
      expect(pointInArea(point, area)).toBe(false);
    }
  });
});

describe('state projection', () => {
  it('replaces membership changes, but filters ordinary deltas without resetting the map', () => {
    const local = projectStateToArea(initial, area);
    expect(scopedMapChanges(undefined, local, {})).toEqual({ reset: true });
    expect(scopedMapChanges(local, local, { reset: true })).toEqual({ reset: true });
    expect(scopedMapChanges(local, local, { nodes: [west], routes: [route(west, east)], routeGeometry: ['west-east'] })).toBeNull();
    expect(scopedMapChanges(local, local, { nodes: [a, west], routes: [route(a, b), route(west, east)], routeGeometry: ['a-b', 'west-east'] }))
      .toEqual({ nodes: [a], routes: [route(a, b)], routeGeometry: ['a-b'] });
    const moved = projectStateToArea({ ...initial, nodes: initial.nodes.map((value) => value.id === 'b' ? { ...value, lng: 13 } : value) }, area);
    expect(scopedMapChanges(local, moved, { nodes: [b] })).toEqual({ reset: true });
    expect(scopedMapChanges(moved, local, { nodes: [b] })).toEqual({ reset: true });
    expect(scopedMapChanges(local, { ...local, nodes: [a, b, c, { ...d, id: 'replacement' }] }, {})).toEqual({ reset: true });
  });
  it('keeps only local endpoints and routes without mutating authoritative state or feed status', () => {
    const before = structuredClone(initial);
    const view = projectStateToArea(initial, area);
    expect(view.nodes.map((value) => value.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(view.routes.map((value) => value.id)).toEqual(['a-b', 'c-d']);
    expect(view.status).toBe(initial.status);
    expect(view.seq).toBe(initial.seq);
    expect(view.bootId).toBe(initial.bootId);
    expect(view.serverTime).toBe(initial.serverTime);
    expect(initial).toEqual(before);
    expect(() => assertStateV2(view)).not.toThrow();
    expect(projectStateToArea(initial, null)).toBe(initial);
  });

  it('removes routes when a node leaves the area, and hides missing/invalid endpoints', () => {
    const changed = { ...initial, nodes: initial.nodes.map((value) => value.id === 'b' ? { ...value, lng: 13 } : value) };
    expect(projectStateToArea(changed, area).routes.map((value) => value.id)).toEqual(['c-d']);
    const unknown = { ...initial, nodes: [a, { ...b, lat: NaN }] };
    expect(projectStateToArea(unknown, area).routes).toEqual([]);
    const empty = projectStateToArea(initial, [[30, 30], [31, 31]]);
    expect(empty.nodes).toEqual([]);
    expect(empty.routes).toEqual([]);
    expect(empty.status.feed).toBe('connected');
  });
});

describe('packet projection', () => {
  it('preserves local runs, drops outside/crossing hops and does not synthesize boundary nodes', () => {
    const original = packet([segment(west, a), segment(a, b), segment(b, c), segment(c, east)]);
    const before = structuredClone(original);
    const projected = projectPacketToArea(original, area);
    expect(projected?.runs).toEqual([{ ...original, segments: [segment(a, b), segment(b, c)] }]);
    expect(original).toEqual(before);
    expect(projectPacketToArea(packet([segment(west, east)]), area)).toBeNull();
    expect(projectPacketToArea(packet([segment(a, west)]), area)).toBeNull();
    expect(projectPacketToArea(packet([]), area)).toBeNull();
    expect(projectPacketToArea(null, area)).toBeNull();
    expect(projectPacketToArea(original, null)?.runs[0]).toEqual(original);
  });

  it('splits omitted hops and discontinuities while keeping one observation identity', () => {
    const original = packet([segment(a, b), segment(b, west), segment(west, b), segment(b, c)]);
    const projected = projectPacketToArea(original, area);
    expect(projected).toMatchObject({ id: original.id, seq: original.seq, at: original.at, payloadType: original.payloadType });
    expect(projected?.runs).toEqual([
      { ...original, segments: [segment(a, b)] }, { ...original, segments: [segment(b, c)] }
    ]);
    expect(projectPacketToArea(packet([segment(a, b), segment(c, d)]), area)?.runs).toHaveLength(2);
    const movedB = { ...b, lng: 11 };
    expect(projectPacketToArea(packet([segment(a, b), segment(movedB, c)]), area)?.runs).toHaveLength(2);
  });

  it('qualifies observer receptions by their coordinate, including the border', () => {
    const observer = { seq: 8, id: 'observation', at: 100, payloadType: 'Advert' as const, mode: 'observer' as const, observer: a };
    expect(projectPacketToArea(observer, area)?.runs).toEqual([observer]);
    expect(projectPacketToArea({ ...observer, observer: node('edge', 10, 20) }, area)).not.toBeNull();
    expect(projectPacketToArea({ ...observer, observer: west }, area)).toBeNull();
    expect(projectPacketToArea({ ...observer, observer: { ...a, lat: NaN } }, area)).toBeNull();
  });

  it('accepts border-to-border hops without rounding just-outside coordinates inward', () => {
    expect(projectPacketToArea(packet([segment(node('edge-a', 10, 20), node('edge-b', 12, 22))]), area)).not.toBeNull();
    expect(projectPacketToArea(packet([segment(a, node('outside', 12.00001))]), area)).toBeNull();
  });
});

describe('projection after the full LiveStore update', () => {
  it('keeps excluded events sequenced, restores all traffic, and matches an authoritative replacement', () => {
    vi.useFakeTimers();
    const store = new LiveStore({ ...initial, routes: [] });
    try {
      let matchedObservations = 0;
      const events: PacketEventV2[] = [
        { seq: 8, id: 'outside', at: 110, payloadType: 'Trace', mode: 'route', segments: [{ routeId: 'west-east', fromId: 'west', toId: 'east' }] },
        { seq: 9, id: 'mixed', at: 120, payloadType: 'Trace', mode: 'route', segments: [
          { routeId: 'a-b', fromId: 'a', toId: 'b' },
          { routeId: 'b-west', fromId: 'b', toId: 'west' },
          { routeId: 'c-d', fromId: 'c', toId: 'd' }
        ] }
      ];
      for (const event of events) {
        expect(sequenceAction(store.snapshot.seq, event.seq)).toBe('next');
        const projection = projectPacketToArea(store.applyPacket(event), area);
        if (projection) matchedObservations += 1;
      }
      expect(store.snapshot.seq).toBe(9);
      expect(matchedObservations).toBe(1);
      vi.advanceTimersByTime(ROUTE_BATCH_MS);
      const local = projectStateToArea(store.snapshot, area);
      expect(local.routes.map((value) => value.id)).toEqual(['a-b', 'c-d']);
      expect(projectStateToArea(store.snapshot, null).routes).toHaveLength(4);
      const replacement = structuredClone(store.snapshot);
      store.replace(replacement);
      expect(projectStateToArea(store.snapshot, area)).toEqual(local);
      expect(() => assertStateV2(local)).not.toThrow();
    } finally {
      store.destroy();
    }
  });
});

function node(id: string, lng: number, lat = 21): NodeV2 {
  return { id, label: id, lat, lng, role: 'repeater', observer: false, lastSeen: 100 };
}

function route(from: NodeV2, to: NodeV2): RouteV2 {
  return { id: `${from.id}-${to.id}`, fromId: from.id, toId: to.id, packetCount: 1, lastHeard: 100, intensity: 0, lastKind: 'Trace', traffic: 1 };
}

function segment(from: NodeV2, to: NodeV2): RouteSegmentView {
  return { routeId: `${from.id}-${to.id}`, from, to };
}

function packet(segments: RouteSegmentView[]): RoutePacketView {
  return { seq: 8, id: 'synthetic-observation', at: 100, payloadType: 'Trace', mode: 'route', segments };
}
