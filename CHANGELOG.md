# Changelog

## Unreleased — `quinte-deployment` fork

- Keep manual scroll position in the lower-left live packet chat and add a green “Live” / red “Not live” control; clicking it or scrolling to the newest packet resumes auto-scrolling.

- Complete the geographic-area Pi release checks; document the remaining
  extreme-scale software-rendering limitation without weakening its test.
  Make browser software rendering explicit and seed the scale fixture's camera
  independently of deployment home bounds. Add a dependency-free area cost check.
- Optionally merge a same-origin, map-safe manual-placement feed. It is ignored
  when unavailable; manual placements are visually distinct and never create
  routes or packet activity. The deployment integration supplies opaque IDs,
  labels, roles, coordinates, and a manual marker only.

Deployment fork for the Quinte West / Belleville (YTR) mesh. Both additions are
optional and default to upstream behaviour.

- Add `CARTO_TILE_BASE`, pointing the client at a same-origin reverse proxy that
  appends the CARTO key server-side, so no browser-visible credential is
  compiled in and the page makes no third-party request for geography. The
  vector tile template is inlined into the style rather than loaded from CARTO's
  TileJSON, which answers with absolute CDN URLs that would bypass the proxy.
- Resolve a relative tile base against the document origin before MapLibre sees
  it. MapLibre loads tiles in a Web Worker whose origin is a `blob:` URL, where
  a root-relative URL fails to parse and the basemap silently never paints.
- Add `STATUS_CONSOLE_ORIGIN`, linking a companion status console from the
  topbar and from each node inspector. The inspector links by public label,
  since node ids are one-way hashes; the label is encoded, not interpolated.
- Accept a `#node=<id>` fragment to open on a given node, validated against the
  id shape the engine emits and applied once the map reports `idle`.
- Add `HOME_BOUNDS` (`west,south,east,north`), pinning the home view and the
  Reset button to one region instead of fitting the bounding box of every node
  heard, which drifts as distant nodes appear and expire. Bounds rather than a
  centre and zoom, so `fitBounds` keeps the framing right on a phone too.
- Default the heat and cluster layers to off. Both are summaries that, at one
  region's scale, cover the individual nodes and routes a reader came for. A
  stored per-visitor choice still wins.
- Title the browser tab `CartoQuinte`.
- Add tested geographic state/packet projections. See the
  [traffic-area contract](docs/traffic-area.md).
- Add Area controls with an optional deployment preset,
  touch-draggable custom rectangle, coordinate fields, Apply/Cancel/Clear,
  validated share links and optional browser persistence.
- Keep map, layer and sound startup usable when browser storage access itself
  throws. Restore compact layer labels and keep menus above the area summary.
- Apply the area to topology, heat, clusters, search/focus, live runs, sound,
  observation counts and Follow while retaining complete SSE sequencing.
  Clear stale geometry and pending effects on scope changes; preserve filtering
  through node movement, recovery and style replacement. Keep feed health
  separate from local activity. R4 deployment/release checks remain pending.

## 0.1.0 - 2026-09-02

- Create the standalone CartoLite Server distribution from CartoLite 0.9.1.
- Accept valid public node coordinates across the Web Mercator world and use a global home view.
- Accept every syntactically valid MQTT region by default; retain an optional exact `REGION_ALLOWLIST` for operators who need one.
- Remove the Canadian broker default, Canadian coordinate gate, MeshMapper regions, Canadian route-texture bounds, and Canadaverse deployment configuration.
- Remove CartoLite Labs and every related renderer, image asset, route, test, and document.
- Remove the Android project, app links, signing material, download links, and mobile release documentation.
- Add a source-build Docker Compose flow using each operator's own CARTO key as a BuildKit secret.
- Preserve public API schema v2, MQTT/SSE recovery, route and packet visuals, musical traffic, node inspection, privacy assertions, checkpoint safety, and hardened runtime defaults.

## 2026-09-05 - Saved observations and latest packet

- Retain sanitized packet observations and available RSSI/SNR across visits, reconnects and graceful restarts, capped at seven days / 10,000 events.
- Add always-visible Latest packet card independent of paused/filtered log, paged saved log and CSV radio fields.
- Replace mobile overlay offsets with a shared layout so node details, traces and the packet card remain accessible.

## 2026-09-05 - Preserve known parts of packet paths

- Keep safe links on both sides of unknown hops; show explicit gaps, isolated known nodes and names without map coordinates.
- Retain public partial-path metadata across visits/restarts and show it in the log, latest packet, CSV and selected map markers.
- Split animation/replay at gaps. Earlier records display their known receiver without inventing missing path history.

### Signal coverage foundation (Stage 1)

- Preserve sanitized final-radio-hop measurements and last-known coordinate timestamps in packet history and live events. Exclude uncertain transmitter attribution; old packet history remains readable. See `docs/signal-coverage-plan.md` for limits and Stage 2.

### Signal coverage summaries (Stage 2)

- Add bounded incoming/outgoing measured-signal summaries for 1h, 24h, and 7d, with exact median/range, reception counts, age, location quality, and exclusions. Keep distinct locations and receivers separate; collapse identical same-millisecond reception records. Map controls follow in Stage 3.

### Signal coverage map (Stage 3)

- Add measured signal controls and coloured point markers to the shared map, with labelled RSSI/SNR bands, sparse/location-age indicators, and accessible measurement details. Keep coverage and packet chat separate on mobile and restore node details when coverage closes.
