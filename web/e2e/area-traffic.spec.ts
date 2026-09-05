import { test, expect, type Page } from '@playwright/test';
import type { NodeV2, PacketEventV2, StateV2 } from '../src/types';

const node = (id: string, lng: number): NodeV2 => ({ id, label: id, lat: 21, lng, role: 'repeater', observer: false, lastSeen: Date.now() });
const nodes = [node('local-a', 10.3), node('local-b', 10.8), node('local-c', 11.2), node('local-d', 11.7), node('outside-w', 9), node('outside-e', 13)];
const pairs = [['local-a', 'local-b'], ['local-c', 'local-d'], ['local-b', 'outside-w'], ['outside-w', 'outside-e']];
function snapshot(): StateV2 {
  return { schemaVersion: 2, bootId: 'synthetic-traffic', seq: 0, serverTime: Date.now(),
    status: { feed: 'connected', activity: 'active', lastPacketAt: Date.now(), dropped: 0, version: 'test', gitSha: 'test' },
    map: { center: [11, 21], zoom: 8 }, nodes,
    routes: pairs.map(([fromId, toId]) => ({ id: `${fromId}/${toId}`, fromId: fromId!, toId: toId!, packetCount: 1, lastHeard: Date.now(), intensity: 0, lastKind: 'Trace', traffic: 1 })) };
}

async function harness(page: Page, current = snapshot()) {
  let state = current;
  let requests = 0;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/state', (route) => { requests++; return route.fulfill({ json: state }); });
  await page.route(/https:\/\//, (route) => route.request().url().includes('tiles.json')
    ? route.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://example.invalid/{z}/{x}/{y}.mvt'], minzoom: 0, maxzoom: 14 } })
    : route.fulfill({ status: 204 }));
  // Instrument test-served modules only; no debug globals in the production build.
  for (const [file, extra] of [
    ['map', `const oldRender=LiveMap.prototype.render; LiveMap.prototype.render=function(...args){window.__liveMap=this; return oldRender.apply(this,args);};`],
    ['packetAnimator', `const oldAdd=PacketAnimator.prototype.add; PacketAnimator.prototype.add=function(p){window.__animated.push(p); window.__animator=this; return oldAdd.call(this,p);};`],
    ['audio', `const oldPlay=RouteSonifier.prototype.play; RouteSonifier.prototype.play=function(p){window.__heard.push(p); window.__sonifier=this; return oldPlay.call(this,p);};`]
  ]) {
    await page.route(`**/src/${file}.ts`, async (route) => {
      const response = await route.fetch({ maxRetries: 2 });
      await route.fulfill({ response, body: `${await response.text()}\n${extra}\n` });
    });
  }
  await page.addInitScript(() => {
    const w = window as any;
    w.__feeds = []; w.__animated = []; w.__heard = [];
    class SyntheticFeed extends EventTarget {
      onopen?: () => void;
      constructor() { super(); w.__feeds.push(this); queueMicrotask(() => this.onopen?.()); }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: SyntheticFeed });
    localStorage.setItem('cartolite-server:ui:v1', JSON.stringify({ routes: true, heatmap: true, clusters: true }));
  });
  return { errors, requests: () => requests, replace: (next: StateV2) => { state = next; } };
}

async function emit(page: Page, type: string, data: unknown) {
  await page.evaluate(({ type, data }) => (window as any).__feeds.at(-1).dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) })), { type, data });
}

function packet(seq: number, hops: string[][]): PacketEventV2 {
  return { seq, id: `observation-${seq}`, at: Date.now(), payloadType: 'Trace', mode: 'route',
    segments: hops.map(([fromId, toId]) => ({ routeId: `${fromId}/${toId}`, fromId: fromId!, toId: toId! })) };
}

async function sourceIDs(page: Page, name: string): Promise<string[]> {
  return page.evaluate(async (name) => {
    // Historical lines are drawn by the custom WebGL layer, not its empty hit source.
    if (name === 'route-details') return (window as any).__liveMap.historicalRouteLayer.routes.map((f: any) => String(f.id)).sort();
    const data = await (window as any).__liveMap.map.getSource(name).getData();
    return data.features.map((f: any) => String(f.id ?? f.properties.id)).sort();
  }, name);
}

async function ready(page: Page) {
  await expect(page.locator('#map')).toHaveAttribute('data-render-state', 'idle');
  await expect.poll(() => sourceIDs(page, 'nodes')).toEqual(['local-a', 'local-b', 'local-c', 'local-d']);
}

async function chooseArea(page: Page, value: string) {
  const appliedNodes = await sourceIDs(page, 'nodes');
  if (await page.locator('#layers-summary').isVisible() && !await page.locator('#area-button').isVisible()) await page.locator('#layers-summary').click();
  await page.locator('#area-button').click();
  await page.locator('#area-mode').selectOption(value);
  expect(await sourceIDs(page, 'nodes')).toEqual(appliedNodes); // Drafts only change the outline.
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('all consumers share the applied scope, mixed runs count once, and Clear restores full state', async ({ page }) => {
  const h = await harness(page);
  await page.goto('/?area=test-region'); await ready(page);
  await expect(page.locator('#status-text')).toHaveText('Connected');
  await expect(page.locator('#area-activity')).toHaveText('No traffic observed in this area');
  await expect.poll(() => sourceIDs(page, 'node-clusters')).toEqual(['local-a', 'local-b', 'local-c', 'local-d']);
  await expect.poll(() => sourceIDs(page, 'route-details')).toEqual(['local-a/local-b', 'local-c/local-d']);
  await page.locator('#sound-button').click();
  await page.locator('#sound-toggle').click();
  await expect(page.locator('#sound-button')).toHaveAttribute('data-sound-state', 'on');
  await page.locator('#sound-button').click();
  await page.locator('#follow-button').click();
  const initialView = await page.evaluate(() => (window as any).__liveMap.view());
  await emit(page, 'packet', packet(1, [['outside-w', 'outside-e']]));
  expect(await page.evaluate(() => [(window as any).__animated.length, (window as any).__heard.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => (window as any).__liveMap.view())).toEqual(initialView);
  await expect(page.locator('#area-activity')).toHaveAttribute('data-observations', '0');
  await emit(page, 'packet', packet(2, [['local-a', 'local-b'], ['local-b', 'outside-w'], ['local-c', 'local-d']]));
  await expect(page.locator('#area-activity')).toHaveAttribute('data-observations', '1');
  expect(await page.evaluate(() => [(window as any).__animated.length, (window as any).__heard.length])).toEqual([2, 2]);
  expect(await page.evaluate(() => (window as any).__animated.map((p: any) => p.segments.map((s: any) => s.routeId))))
    .toEqual([['local-a/local-b'], ['local-c/local-d']]);
  await expect(page.locator('#sound-activity')).toHaveAttribute('data-scheduled', '2');
  await emit(page, 'packet', { seq: 3, id: 'local-reception', at: Date.now(), payloadType: 'Advert', mode: 'observer', observer: nodes[0] });
  await emit(page, 'packet', { seq: 4, id: 'outside-reception', at: Date.now(), payloadType: 'Advert', mode: 'observer', observer: nodes[4] });
  await expect(page.locator('#area-activity')).toHaveAttribute('data-observations', '2');
  expect(h.requests()).toBe(1); // Excluded sequences must not trigger recovery.
  expect(await page.evaluate(() => (window as any).__liveMap.findNodes('outside'))).toEqual([]);
  await page.evaluate(() => (window as any).__liveMap.selectNodeByID('local-a', false));
  await page.locator('#area-clear').click();
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', '');
  await expect(page.locator('#follow-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#traffic-meter')).toHaveAttribute('data-level', '0');
  await expect(page.locator('#packet-canvas')).toHaveAttribute('data-active-routes', '0');
  expect(await page.evaluate(() => (window as any).__sonifier.active.size)).toBe(0);
  await expect.poll(() => sourceIDs(page, 'nodes')).toHaveLength(6);
  await expect.poll(() => sourceIDs(page, 'route-details')).toHaveLength(4);
  await chooseArea(page, 'test-region');
  await ready(page);
  await expect(page.locator('#area-activity')).toHaveAttribute('data-observations', '0');
  expect(h.errors).toEqual([]);
});

test('node movement removes and restores geometry; authoritative reconnect keeps the area', async ({ page }) => {
  const h = await harness(page);
  await page.goto('/?area=test-region'); await ready(page);
  await page.evaluate(() => (window as any).__liveMap.selectNodeByID('local-b', false));
  await emit(page, 'node', { seq: 1, node: { ...nodes[1], lng: 13 } });
  await expect.poll(() => sourceIDs(page, 'nodes')).toEqual(['local-a', 'local-c', 'local-d']);
  await expect.poll(() => sourceIDs(page, 'route-details')).toEqual(['local-c/local-d']);
  await expect(page.locator('#map')).toHaveAttribute('data-selected-node-id', '');
  await emit(page, 'node', { seq: 2, node: nodes[1] });
  await ready(page);
  await expect.poll(() => sourceIDs(page, 'route-details')).toHaveLength(2);
  const replacement = snapshot(); replacement.seq = 4;
  replacement.nodes = replacement.nodes.filter((n) => n.id !== 'local-d');
  replacement.routes = replacement.routes.filter((r) => r.toId !== 'local-d');
  h.replace(replacement);
  await emit(page, 'packet', packet(4, [['outside-w', 'outside-e']])); // Gap forces snapshot replacement.
  await expect.poll(h.requests).toBe(2);
  await expect.poll(() => sourceIDs(page, 'nodes')).toEqual(['local-a', 'local-b', 'local-c']);
  await expect.poll(() => sourceIDs(page, 'route-details')).toEqual(['local-a/local-b']);
  await emit(page, 'packet', packet(5, [['local-a', 'local-b']]));
  await expect(page.locator('#area-activity')).toHaveAttribute('data-observations', '1');
  await expect(page.locator('#map')).toHaveAttribute('data-area-bounds', '10,20,12,22');
  expect(h.errors).toEqual([]);
});

test('style replacement restores scoped nodes, routes, heat and outline without duplicate handlers', async ({ page }) => {
  const state = snapshot();
  state.routes[1]!.lastHeard = Date.now() - 2 * 60 * 60_000;
  const h = await harness(page, state);
  await page.goto('/?area=test-region'); await ready(page);
  await page.evaluate(() => (window as any).__liveMap.setRouteWindow('15m'));
  await expect(page.locator('#map')).toHaveAttribute('data-eligible-routes', '1');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => (window as any).__liveMap.map.setStyle({ version: 8, sources: {}, layers: [{ id: 'test-background', type: 'background', paint: { 'background-color': '#0b151b' } }] }, { diff: false }));
    await ready(page);
    await expect.poll(() => sourceIDs(page, 'route-details')).toHaveLength(2);
    await expect(page.locator('#map')).toHaveAttribute('data-eligible-routes', '1');
    expect(await page.evaluate(() => (window as any).__liveMap.historicalRouteLayer.maximumBand)).toBe(0);
    await expect.poll(() => page.evaluate(() => Boolean((window as any).__liveMap.map.getLayer('traffic-area-outline')))).toBe(true);
    const points = await page.evaluate(async () => {
      const data = await (window as any).__liveMap.map.getSource('activity-heat-source').getData();
      return data.features.map((f: any) => f.geometry.coordinates);
    });
    expect(points.length).toBeGreaterThan(0);
    for (const [lng, lat] of points) { expect(lng).toBeGreaterThanOrEqual(10); expect(lng).toBeLessThanOrEqual(12); expect(lat).toBe(21); }
  }
  await page.evaluate(() => (window as any).__liveMap.setRouteWindow('6h'));
  await expect(page.locator('#map')).toHaveAttribute('data-eligible-routes', '2');
  expect(h.errors).toEqual([]);
});
