# Geographic traffic projection

Status: R2 boundary-preview checkpoint. Controls select and outline an area;
traffic is explicitly **not filtered yet**. Live integration follows in R3.

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

## Following checkpoints

R2 adds validated area controls, preferences, an outline and deployment-specific
preset configuration. These are now implemented. R3 connects all map layers, search, focus, animation,
sound and activity indicators to the same projection. Switching scope must clear
pending effects and remove old geometry; filtered upserts alone cannot do that.
R4 performs end-to-end/recovery, privacy, performance and release checks before
deployment. R2 does not change visible traffic.

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
the editor and MapLibre outline. R3 should consume the applied selection only,
never an unsaved draft, and remove the explicit preview wording only after every
traffic consumer uses the same scope.

## R2 verification

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

## R1 verification

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
