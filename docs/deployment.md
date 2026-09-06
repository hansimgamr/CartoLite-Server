# Deployment

## Build and start

Copy `.env.example` to `.env`, create `.secrets/carto-basemap-api-key`, and configure your MQTT broker. Then run:

```sh
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:8080/readyz
```

The BuildKit secret injects the browser-visible CARTO project key into the compiled client without placing it in source, Compose, image labels, or build logs. Verify that TileJSON, vector PBF, and glyph requests authorize from the final public origin.

## Configuration

| Variable | Default | Purpose |
|---|---:|---|
| `CARTOLITE_BIND_ADDR` | `127.0.0.1` | Published host address |
| `CARTOLITE_PORT` | `8080` | Published host port |
| `MQTT_BROKER_URL` | required | `tcp`, `ssl`, `ws`, or `wss` broker URL |
| `MQTT_TOPIC` | `meshcore/#` | Broker subscription |
| `MQTT_CLIENT_ID` | `cartolite-server` | Unique MQTT client ID |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | empty | Optional credentials; set both or neither |
| `REGION_ALLOWLIST` | empty | Accept all regions, or exact comma-separated labels |
| `MQTT_INGEST_QUEUE_SIZE` | `4096` | Bounded queue, from 64 through 65536 |
| `STATE_PATH` | `/data/state-v1.json` | Atomic checkpoint path |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |
| `CARTO_TILE_BASE` | empty | Same-origin basemap proxy path; see below |
| `STATUS_CONSOLE_ORIGIN` | empty | Companion status console to link to |
| `HOME_BOUNDS` | empty | `west,south,east,north` home view for one region |

`CARTO_BASEMAP_API_KEY_FILE` points Compose at the BuildKit secret file. Do not place the key in `.env`.

## Public operation

Use a TLS reverse proxy and forward to the loopback port. Do not expose `.env`, `.secrets`, or the data volume. Keep the supplied read-only filesystem, non-root user, dropped capabilities, memory limit, process limit, healthcheck, and bounded logs.

`/healthz` reports liveness. `/readyz` requires a healthy checkpoint, connected and subscribed MQTT client, healthy queue, and zero drops. Normal RF silence is ready.

Before an upgrade, copy the checkpoint and record the current image ID. Build the new source revision, recreate only the `cartolite` service, and verify health, readiness, schema v2 privacy, SSE traffic, vector resources, desktop/mobile layout, and container hardening. Roll back to the recorded image and checkpoint if any gate fails.

## Same-origin basemap proxy (optional)

Upstream compiles a browser-visible CARTO key into the frontend. A deployment
that would rather not publish a credential — or would rather the page make no
third-party request at all — can instead point the client at a reverse proxy on
its own origin that appends the key server-side.

Set `CARTO_TILE_BASE` to that path (for example `/carto-tiles`) and leave the
BuildKit secret unset. The client then requests only:

```text
<CARTO_TILE_BASE>/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt
<CARTO_TILE_BASE>/fonts/{fontstack}/{range}.pbf
```

The proxy must forward both to `basemaps.cartocdn.com` with `?key=` appended.
The tile template is inlined into the style rather than fetched from CARTO's
TileJSON, because that document answers with absolute
`tiles-{a,b,c,d}.basemaps.cartocdn.com` URLs that MapLibre would otherwise
fetch directly, bypassing the proxy.

A relative `CARTO_TILE_BASE` is resolved against the document origin before the
style is built. That is not cosmetic: MapLibre loads tiles inside a Web Worker
whose own origin is a `blob:` URL, and a root-relative URL reaching it fails
with `Failed to construct 'Request': Failed to parse URL`. The requests never
leave the browser, so the network panel shows nothing wrong and the basemap
simply never paints. An absolute `CARTO_TILE_BASE` is passed through untouched,
so the proxy may live on another host.

Glyph paths contain spaces (`Open Sans Regular`). A proxy that rebuilds the
upstream URL from a regex capture must emit the percent-encoded form: nginx
matches locations against the *decoded* URI, so the capture holds real spaces,
and a variable in `proxy_pass` is not re-encoded — which would put a raw space
in the upstream request line.

A worked nginx example, with the key kept in an `include`d file holding
`set $carto_key "…";`:

```nginx
location ~ "^/carto-tiles/(?<vpath>vectortiles/[A-Za-z0-9_/.@-]+\.mvt)$" {
    include /run/secrets/carto_key;
    proxy_ssl_server_name on;
    proxy_set_header Host basemaps.cartocdn.com;
    proxy_pass https://basemaps.cartocdn.com/$vpath?key=$carto_key;
}

# The fontstack is spelled out rather than captured, so %20 can be written
# literally upstream. A new font in the style needs its own location.
location ~ "^/carto-tiles/fonts/Open Sans Regular/(?<range>[0-9]+-[0-9]+)\.pbf$" {
    include /run/secrets/carto_key;
    proxy_ssl_server_name on;
    proxy_set_header Host basemaps.cartocdn.com;
    proxy_pass https://basemaps.cartocdn.com/fonts/Open%20Sans%20Regular/$range.pbf?key=$carto_key;
}
```

Verify in a browser rather than with `curl`: the failure mode above produces no
HTTP request at all. Check that tiles return `200`, that the page requests no
host but your own, and that the bundle contains no key.

Topography and 3D still reach Mapterhorn directly, and only after a visitor
enables them — the one remaining third-party request, and opt-in.

## Home region (optional)

By default the map opens on the bounding box of every node it has heard, which
is right for a worldwide instance. An operator covering one region usually wants
a fixed frame instead: the fitted box drifts as distant nodes appear and expire,
so the map opens somewhere slightly different each visit and the Reset button
lands somewhere different again.

Set `HOME_BOUNDS` to `west,south,east,north`:

```sh
HOME_BOUNDS=-77.90,43.88,-76.85,44.35
```

Bounds rather than a centre and zoom on purpose — `fitBounds` derives the zoom
from the viewport, so one setting frames the region correctly on a desktop and
on a phone, where a fixed zoom would crop it. Malformed, reversed or
out-of-range values are ignored and the worldwide fit is used, so a typo
degrades to upstream behaviour rather than pointing the map at nothing.

The value applies to the initial view and to the Reset control. A returning
visitor's own saved view still takes precedence.

## Traffic area preset (optional)

`AREA_PRESET_ID`, `AREA_PRESET_LABEL` and `AREA_PRESET_BOUNDS` configure one
operator-defined display rectangle, separately from `HOME_BOUNDS` and the MQTT
`REGION_ALLOWLIST`. All three are public, non-secret build settings, empty by
default; changes require rebuilding the frontend/container. The source contains
no regional default. See [area controls and validation](traffic-area.md).

The area is integrated into all display consumers and released on the deployment
fork. It does not restrict the public API or MQTT intake. See the R4 results and
known extreme-scale limitation in [traffic-area.md](traffic-area.md). When using
a parent Compose project, wire all three `VITE_AREA_PRESET_*` build arguments
there too; changing this repository's standalone Compose file alone has no
effect on a parent project. Preserve its existing networking and runtime values.

## Layer defaults

`DEFAULT_UI_PREFERENCES` in `web/src/preferences.ts` sets what a **first** visit
shows. Anyone who has toggled a layer keeps their own stored choice, so changing
these never overrides a visitor.

This deployment ships heat and clusters off: both are summaries, and at one
region's scale they largely cover the individual nodes and routes a reader came
to look at. Upstream ships both on, which suits a worldwide view where the
individual marks are too dense to read.

## Companion status console (optional)

## Planned deployment markers

The Quinte reverse proxy adds a map-safe `GET /api/manual-nodes` projection with
an additional `planned` array. Draft, Planned, and Scheduled deployment records
with both coordinates are rendered by the map as `📅` markers. The Deployment
Planner opens `?picker=1` in a new map window; a click sends only latitude and
longitude back to `deploy.hansimgamr.net`, where the operator can still edit or
type the values before saving.

Set `STATUS_CONSOLE_ORIGIN` to link a separate status site from the topbar and
from each node inspector. Node ids are one-way hashes, so the inspector links by
public label as `?node=<label>` — the receiving site should match that label
tolerantly, since it is the node's over-the-air name and may carry an emoji
prefix its own directory does not.

The map also accepts `#node=<id>` to open on a given node, which lets a console
holding public keys link back: a node's public id is `n-` followed by the first
24 hex characters of `sha256` over the **uppercase** key. The fragment is
validated against that shape and otherwise ignored. It is applied once the map
reports `idle`, because the style and layers must exist before a node can be
selected.

## Coverage history operations

Stages 1–4 of [signal coverage](signal-coverage-plan.md) are deployed on `feat/live-traces`; implementation checkpoint `85a5fb4` includes persistent summaries. Keep the `/data` volume when recreating the service. On first upgrade, eligible retained packets seed the archive once. Reloads and graceful restarts preserve it; abrupt failure can lose the last five minutes of updates.

Coverage retains at most seven days, subject to global caps of 30,000 five-minute location buckets, 500,000 occupied histogram bins, and 20,000 recent dedup identities. Capacity eviction can shorten retention. Protect checkpoint backups as private operational data. Preserve a backup before downgrading: older binaries may discard the coverage field when writing their checkpoint.

After an upgrade, query `/api/signal-coverage` with a known public node ID, a direction, and a window. Check `schemaVersion: 2`, `bucketMinutes: 5`, `approximateMedian: true`, and the expected summaries. Compare a nonempty group before/after an orderly restart, allowing newly received samples. No new environment variables or services are required.

The Stage 4 release passed Go tests/vet, 133 frontend tests, builds, and isolated MQTT integration/privacy smoke. Go race execution remains blocked by this Pi kernel's unsupported VMA range; rerun on a supported host. These are recorded release results, not checks rerun by documentation-only commits. Stage 5 prediction inputs and Stage 6 field validation remain outstanding.
