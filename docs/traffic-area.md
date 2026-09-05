# Geographic traffic projection

Status: R1 logic checkpoint. No area controls or live display filtering yet.

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
preset configuration. R3 connects all map layers, search, focus, animation,
sound and activity indicators to the same projection. Switching scope must clear
pending effects and remove old geometry; filtered upserts alone cannot do that.
R4 performs end-to-end/recovery, privacy, performance and release checks before
deployment. Until then these helpers do not change visible traffic.

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
