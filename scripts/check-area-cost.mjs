// Run with Node >=22.12: node --experimental-strip-types scripts/check-area-cost.mjs
// Synthetic projection benchmark, not a GPU/frame-rate or broker benchmark.
import assert from 'node:assert/strict';
import { projectStateToArea, scopedMapChanges, projectPacketToArea } from '../web/src/trafficArea.ts';

const nodes = Array.from({ length: 4000 }, (_, i) => ({ id: `n${i}`, lat: 20 + (i % 100) / 50, lng: 10 + Math.floor(i / 100) / 10 }));
const routes = Array.from({ length: 7000 }, (_, i) => ({ id: `r${i}`, fromId: nodes[i % 4000].id, toId: nodes[(i + 1) % 4000].id }));
const state = { nodes, routes }, area = [[10, 20], [12, 22]];
const packet = { mode: 'route', segments: routes.slice(0, 20).map((r, i) => ({ routeId: r.id, from: nodes[i], to: nodes[i + 1] })) };
let previous = projectStateToArea(state, area);
const times = [];
for (let i = 0; i < 600; i++) {
  const start = performance.now();
  const next = projectStateToArea(state, area);
  assert.notEqual(next, state);
  scopedMapChanges(previous, next, { nodes: [nodes[0]], routes: [routes[0]] });
  assert.equal(projectPacketToArea(packet, area).runs.length, 1);
  previous = next;
  if (i >= 100) times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
assert.equal(previous.nodes.length, 2100);
assert.equal(previous.routes.length, 4198);
console.log(JSON.stringify({ inputNodes: nodes.length, inputRoutes: routes.length,
  localNodes: previous.nodes.length, localRoutes: previous.routes.length,
  medianMs: times[250], p95Ms: times[475] }));
assert(times[475] < 16.7, 'projection and delta filtering should fit a frame budget');
