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

Glyph paths contain spaces (`Open Sans Regular`), so a proxy that rebuilds the
upstream URL from a regex capture must emit the percent-encoded form.

Topography and 3D still reach Mapterhorn directly, and only after a visitor
enables them.

## Companion status console (optional)

Set `STATUS_CONSOLE_ORIGIN` to link a separate status site from the topbar and
from each node inspector. Node ids are one-way hashes, so the inspector links by
public label as `?node=<label>`.
