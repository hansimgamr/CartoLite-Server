# Public API v2

All endpoints are public and intentionally sanitized. State responses use `Cache-Control: no-store`.

## Endpoints

- `GET /healthz` reports process liveness and build identity.
- `GET /readyz` succeeds only when checkpoint state is healthy, MQTT is connected and subscribed, the ingest queue is healthy, and no packets have been dropped. Normal RF silence remains ready.
- `GET /api/state` returns the authoritative `StateV2` snapshot.
- `GET /api/events?bootId=<boot>&after=<seq>` is a same-origin `text/event-stream` with 15-second keepalives. It replays a bounded sequence window before switching to live events; `Last-Event-ID` is honored on native reconnects. An expired cursor, changed boot, or retention-pruned topology receives `reset` and must rehydrate from `/api/state`.

## State schema

```ts
type StateV2 = {
  schemaVersion: 2;
  bootId: string;
  seq: number;
  serverTime: number;
  status: {
    feed: "connected" | "disconnected";
    activity: "active" | "quiet";
    lastPacketAt?: number;
    dropped: number;
    version: string;
    gitSha: string;
  };
  map: { center: [0, 20]; zoom: 1.4 };
  nodes: NodeV2[];
  routes: RouteV2[];
};

type NodeV2 = {
  id: string;
  label: string;
  role: "repeater" | "companion" | "room_server" | "sensor" | "unknown";
  observer: boolean;
  lat: number;
  lng: number;
  lastSeen: number;
};

type RouteV2 = {
  id: string;
  fromId: string;
  toId: string;
  packetCount: number;
  lastHeard: number;
  intensity: 0 | 1 | 2 | 3 | 4;
  lastKind: "Advert" | "Trace" | "Text" | "ACK" | "Control" | "Request" | "Response" | "AnonReq" | "Path" | "Other";
  traffic: number;
};
```

Every `fromId` and `toId` references one node in the same snapshot. Endpoint labels and coordinates are not duplicated on routes. `lastKind` is the single sanitized kind from the newest packet observed on the route. `traffic` is a bounded activity score measured at `lastHeard`; clients decay it with a 15-minute half-life. It is not packet history or a per-kind counter. Routes older than 24 hours are omitted.

## Event stream

Event names are `hello`, `node`, `packet`, `status`, and `reset`. State-changing events carry the increasing sequence as their SSE `id`; `hello` deliberately has no SSE ID so a disconnect cannot skip its following replay.

Route packet events use the same normalized identifiers:

```ts
type RoutePacketEventV2 = {
  seq: number;
  id: string;
  at: number;
  payloadType: "Advert" | "Trace" | "Text" | "ACK" | "Control" | "Request" | "Response" | "AnonReq" | "Path" | "Other";
  mode: "route";
  segments: Array<{ routeId: string; fromId: string; toId: string }>;
};
```

Observer packet events contain one sanitized `{ id, label, role, lat, lng }` point instead of `segments`. The optional endpoint `role` is the same public node role used in `NodeV2`; it is included so trace readers can identify named companions. No event contains message content, public keys, raw paths, packet hashes, credentials, or resolver details.

## Compatibility

Schema v2 intentionally replaces the embedded `route.from` and `route.to` objects from v1. Clients must reject unknown `schemaVersion` values. Additive fields may appear within v2; removing or changing an existing field requires another schema version.


## Saved observation history (September 2026)

The operator-approved saved packet/radio history extends the earlier live-only design. See [Live Traces](live-traces.md) for the bounded seven-day / 10,000-observation archive, public `/api/packet-history` schema, optional RSSI/SNR and checkpoint durability. Only sanitized public observation metadata is retained; no message payloads or keys are added.

## Partial packet paths

New observations include optional `path` (ordered steps containing a sanitized `label` and optional public `node` endpoint) and `partial` in both SSE and saved PacketView records. Unknown sender/hop/receiver positions and unverified links are explicit gaps. Known nodes without coordinates retain their public name with “location unavailable”. A single unresolved hop no longer discards safe adjacent links elsewhere in the path. Raw path hashes and internal resolver details are not exposed.

The log, latest-packet card and CSV show the known path with ellipses for gaps. Selecting an event numbers its known map positions; Show known path fits them. Only adjacent, uniquely resolved, positioned endpoints passing the existing RF/distance checks produce mapped links. Animation/replay splits disconnected fragments even in the All traffic view and never crosses a gap. Older saved observer events still show the receiving node; missing historical path details cannot be reconstructed.

Mapped segments may include `breakBefore: true` to start a separate fragment after an unresolved interval, even if two fragments meet at the same known node. Consumers must not animate continuously across that boundary.

## Measured signal coverage

`GET /api/signal-coverage?node=n-...&direction=outgoing&window=24h` requires all three parameters. Direction is `incoming` or `outgoing`; window is `1h`, `24h`, or `7d`. Invalid parameters return 400. An unknown valid public node ID returns empty summaries. Responses use `Cache-Control: no-store`.

| Field | Meaning |
|---|---|
| `schemaVersion`, `nodeId`, `direction`, `window` | Version 2 and the requested selection. |
| `from`, `to` | Unix milliseconds; `from` is rounded down to a five-minute boundary. |
| `partial` | Always true: received observations cannot establish complete coverage or delivery rate. |
| `bucketMinutes`, `approximateMedian` | 5 and true. |
| `summaries` | Groups containing `transmitter` and `receiver` public endpoint snapshots, `locationQuality`, `samples`, `firstAt`, `lastAt`, `ageMs`, and optional `rssi` / `snr`. |
| `rssi`, `snr` within a summary | Independent `{count, median, min, max}` statistics, in dBm / dB. Median uses 1 dB / 0.25 dB bins; min/max remain exact. Missing metrics are omitted. |
| `locationQuality` | `last-known`, `unknown-age`, or `stale` (a location report more than 24 hours before reception). |
| `exclusionScope` | `retained-raw-history`; diagnostics do not cover the full aggregate archive. |
| `excluded` | Selected-node raw-record counts by `unattributed-transmitter`, `location-newer-than-packet`, `missing-radio`, or `duplicate-reception`. |
| `unassigned` | Window-wide raw records whose selected endpoint is unknown; not a selected node's missing traffic. |

Outgoing selects the transmitter and plots receivers; incoming selects the receiver and plots transmitters. RSSI/SNR apply only to the verified final reception. Both endpoint coordinates and location quality define a group, so moved locations remain separate. Diagnostic counts use the requested window before bucket rounding. A bucket with a future latest reception is withheld until that timestamp.

Packet SSE and saved observations optionally include `measurement: {receiver, transmitter?, receiverLocationAt?, transmitterLocationAt?, locationQuality: "last-known"}`. Location timestamps are Unix milliseconds; absent values mean unknown report age. A receiver-only snapshot cannot supply pairwise coverage. The optional packet-level `rssi` and `snr` describe this reception, not every path segment. Older observations are not backfilled.

See [coverage retention and duplicate limits](signal-coverage-plan.md#stage-4-checkpoint--persistent-measured-history).
