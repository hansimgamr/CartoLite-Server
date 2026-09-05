# Geographic traffic projection

Status: R1-R4 delivered. The applied area filters topology and every live
display consumer; the deployment fork has completed its Pi release checks.
See the R4 results and the remaining extreme-scale rendering limitation below.

`web/src/trafficArea.ts` projects the existing sanitized schema v2 state and
resolved packet views into a rectangular display area. It adds no dependency,
backend ingestion restriction, API field, or location-specific preset.

## Contract

- Parse `west,south,east,north` with `parseAreaBounds`. Reject empty fields,
  non-finite values, reversed/zero-size bounds, dateline wrapping and coordinates
  beyond the Web Mercator world. The existing home-view parser reuses this check.
- Include nodes on the rectangle border. Include a route only when both known
  endpoints qualify. An outside-to-outside crossing does not qualify.
- Project a route observation into contiguous local runs. An omitted hop or
  mismatched endpoint breaks a run; never invent a connection over the gap.
- `AreaPacket` represents one matching observation with one or more runs.
  Count it once, not once per run. Its id is an observation identity, not a
  guarantee of a unique physical RF transmission.
- Qualify observer-only receptions by the observer coordinate, not an inferred
  packet origin. Invalid coordinates do not qualify.
- A null area returns the original full state/packet view. Inputs are not mutated.

Always apply the complete event to `LiveStore` and preserve normal SSE sequence
handling **before** projecting the returned packet view. Keep authoritative
snapshots and route batches unfiltered. Never replace the store with a projected
snapshot. Global feed status remains global; a quiet area is not a disconnected
feed. This display filter is not an access-control boundary.

## Release gate

R1 provided projections, R2 the editor, and R3 connects topology, search/focus,
animation, sound, local observations and Follow. R4 tested and deployed that
implementation. Operators must still repeat their own backend, privacy,
integration, backup and browser checks before upgrading another instance.

## Area controls (R2)

Open **Area** in the control bar (under **Layers** on compact screens).
Choose All received traffic, the optional operator preset, or Custom area.
Custom editing provides four corner drag targets, a centre move target and
labelled numeric coordinate fields. Touch targets are at least 44px. Apply
validates and saves; Cancel or Escape discards the draft even with invalid or
empty fields. Fit area frames the rectangle around the editor, and Clear area
removes the selection. Moving the map never changes the applied rectangle.

Selections are stored separately from viewport/layer preferences. A single
explicit `?area=<preset-id>`, `?area=west,south,east,north` or `?area=all` takes
precedence over storage. Repeated/invalid/unavailable values show an inline
warning and select All; they never silently resurrect a previous area.
Apply/Clear replace only the area query parameter, retaining unrelated parameters
and node fragments. The selected-area link can be copied through the browser's
normal link menu. If storage access or writes are blocked, selection still works
for the visit and the URL remains shareable. No browser popup dialogs are used.

The generic build contains no regional preset. Configure the public, non-secret
`AREA_PRESET_ID`, `AREA_PRESET_LABEL`, and `AREA_PRESET_BOUNDS` settings in the
operator's private environment and rebuild. Compose passes their `VITE_` build
arguments. Invalid or incomplete configuration omits the preset; custom area
selection still works. IDs must be lowercase URL slugs of at most 32 characters,
excluding `all` and `custom`; labels must be nonempty and at most 60 characters.
Bounds use the same validation as the home-view bounds but need not match them.

`areaSelection.ts` handles validation/persistence and `areaControls.ts` handles
the editor and MapLibre outline. Only Apply/Clear notify the traffic consumers;
unsaved drafts change the outline, not the traffic filter.

## Integrated display (R3)

- The authoritative `LiveStore` always receives full snapshots and events.
  `main.ts` projects them immediately before map rendering or packet dispatch.
  Excluded events still advance the SSE cursor, preventing false recovery gaps.
- Nodes, historical routes, heat, clusters, search and inspection share the
  projected snapshot. `scopedMapChanges` filters ordinary deltas; additions or
  removals of membership force source replacement because upserts cannot remove
  old geometry or restore newly eligible existing routes.
- Replacement clears stale WebGL routes and GeoJSON/heat sources before async
  route hydration. All async work is epoch-guarded. Style replacement restores
  scoped sources and the outline without rebinding click handlers. Existing
  route-age windows continue to intersect the area filter.
- One matching observation may yield multiple separate local runs for animation
  and sound, but increments the live counter once. Follow receives one qualifying
  run, never a fabricated route bridging omitted hops. Observer pulses mean a
  local reception, not a known local packet origin.
- Area changes clear selections/search, Follow queues, animations, residue,
  node wakes, pending sound (including the delay buffer), and UI pulses/counters.
  Node coordinate changes and authoritative replacements also clear transient
  effects. A reconnect starts a fresh live-observation counter; snapshots do not
  imply replayed observations or a unique RF packet count.
- Feed connectivity stays global. With a selected area, the top status reports
  Connected/Reconnecting/Feed offline, while the area line reports no observations
  or the matching count and last event time since selection/reconnect. An empty
  area never makes a connected feed appear offline.

The filtered path scans the current nodes/routes on batched topology updates;
normal unchanged-membership deltas remain incremental. R4 measured this path;
no membership index or new dependency was needed for the deployed scale.

## R4 release checks - 2026-09-04

- Frontend: 129 unit tests, TypeScript/build, all 30 isolated area-browser checks
  across five viewport profiles. Compressed JS/CSS was 317,797 bytes against a
  358,400-byte budget. The standard Vite large-chunk advisory remains.
- Backend: module verification, tests and vet passed on arm64; tests, vet and
  race passed on Linux amd64. The Pi kernel exposes a 39-bit virtual address
  range, which this Go arm64 race runtime rejects; do not report that failed
  runtime launch as a race-free arm64 test or change the kernel just to run it.
- Isolated broker/container: health/readiness, synthetic snapshot/SSE privacy
  and route-reference checks passed. 1,200 observations were published at
  2,729/s with eight SSE clients, 188 ms broker-to-stream latency, no drops,
  13,216 KiB RSS and zero process writes during the measured burst. These are
  short synthetic measurements, not sustained throughput guarantees.
- Production: configured preset, real vector tiles/glyphs, scoped counts,
  Apply/Cancel/Clear/reload and containment verified on desktop, phone, small
  phone and tablet. Public schema/SSE stayed unchanged; strict CSP remained.
  The deployed executable matched the tested candidate byte-for-byte.
- A private checkpoint/config/image backup was copied off-device and verified.
  The old image successfully restored that checkpoint in an isolated container
  with MQTT disabled. No production data, credentials or captures are in Git.

Reproduce the projection-only cost check with:

```sh
node --experimental-strip-types scripts/check-area-cost.mjs
```

At 4,000 nodes/7,000 routes, projection plus delta selection and a 20-hop packet
took 0.82 ms median / 1.27 ms p95 on the release-check workstation. This is not
a GPU-frame measurement. The browser burst-coalescing checks passed on desktop,
phone and landscape, and the tablet layout check passed.

**Known follow-up, not an all-green stress-suite claim:** with real tiles and
software WebGL, the 4k/7k neighbour-selection stress check exceeded its 750 ms
long-task limit on desktop/phone (1,501/1,678 ms). The prior deployed image also
failed the same check (1,441/927 ms); landscape passed on the candidate. No
threshold was relaxed. This is a remaining large-topology rendering issue,
separate from the local-area release; the deployed topology was under 200 nodes.
Profile rendering before claiming smooth operation at 4k nodes on software GPUs.

## R3 checks

The dedicated browser configuration now includes `area-traffic.spec.ts` as well
as the editor checks. It exercises the real LiveStore/LiveFeed browser code with
synthetic events and snapshots, inspects actual rendered WebGL route data and
GeoJSON sources, and checks packet/audio dispatch, outside-event suppression,
split observation counting, selection cleanup, node movement, cursor-gap recovery,
style replacement, and route-age intersection. Module instrumentation exists only
in the test-served responses; no debugging globals ship in the production bundle.

This synthetic harness is not the production MQTT/SSE or tile-service release
smoke test. The unchanged backend and public schema still require the R4 release
suite. No broker messages, credentials or runtime state are used as fixtures.

R3 checkpoint: all 129 frontend tests passed across 12 files, all 30 synthetic
browser checks passed across five viewport profiles, and TypeScript/production
build passed. The build still reports its bundle-size advisory. The standard
browser suite excludes this separately configured synthetic area harness.

## R2 verification (historical checkpoint)

Run the isolated browser checks from `web/` with:

```sh
npx playwright test --config playwright.area.config.ts
```

The test server binds only to loopback. It uses a synthetic preset/state, a quiet
mock event stream and empty intercepted tiles, not a broker, real geography or
basemap credential. Checks cover desktop, phone, portrait tablet, phone landscape
and small-phone layouts, mouse/touch dragging, keyboard entry, invalid-input
cancellation, URL precedence, reload, Clear, target sizes, containment and blocked
storage. Screenshots remain ignored test output. These are editor checks, not a
claim of production tile, live SSE or geographic filtering verification.

R2 checkpoint: 127 frontend tests and 15 browser checks passed; TypeScript and
production build passed. Vite retains its bundle-size advisory. No Pi release
or full backend/integration release suite was performed in this stage.

## R1 verification (historical checkpoint)

Synthetic tests in `web/src/trafficArea.test.ts` cover invalid bounds, edges,
crossing routes, moved/missing coordinates, observer receptions, mixed and
disconnected runs, source immutability, full stream sequencing, restoring the
unfiltered view and authoritative state replacement.

Run from `web/`:

```sh
npm test -- --reporter=dot
npm run build
```

Checkpoint result: all 122 frontend tests passed across 11 files; TypeScript and
the production build passed. Vite reports a bundle-size advisory. No backend or
deployment settings changed; full release checks remain required for R4.
