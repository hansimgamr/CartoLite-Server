# Privacy boundary

CartoLite Server publishes only schema v2 nodes, routes, status, and sanitized packet kinds. It never publishes full node or observer keys, raw paths, packet hashes, packet payloads, message text, credentials, resolver reasons, or MQTT region labels.

The Node Finder searches already-downloaded public labels in the browser. Queries are neither sent nor persisted. Inspector content is built with DOM text nodes rather than HTML insertion.

The browser stores only separate desktop/mobile views, map layer and route-window choices, and `{enabled, volume, scene}` sound preferences. Remembered sound still requires a fresh user gesture. There are no cookies, accounts, analytics, advertising identifiers, or visitor logs.

Enabling Topography or 3D causes normal attributed elevation-tile requests to Mapterhorn. The CARTO vector basemap makes normal browser requests using the operator's browser-visible project key. Neither request includes MeshCore traffic data.

The atomic server checkpoint contains current topology and private resolver keys needed for restart. Treat it as private operational data: back it up encrypted, never publish it, and never attach a live copy to an issue.


## Saved observation history (September 2026)

The operator-approved saved packet/radio history extends the earlier live-only design. See [Live Traces](live-traces.md) for the bounded seven-day / 10,000-observation archive, public `/api/packet-history` schema, optional RSSI/SNR and checkpoint durability. Only sanitized public observation metadata is retained; no message payloads or keys are added.

## Measured signal summaries

Coverage exposes public endpoint snapshots, reception counts/times, location quality, and RSSI/SNR statistics. Its bounded seven-day histogram archive and recent sanitized dedup identities share the private checkpoint. No payload hashes, decoded messages, or additional resolver keys are added. Coordinates are last-known reports, not verified receiver positions at reception time. These public measurements do not establish continuous coverage or delivery percentages.
