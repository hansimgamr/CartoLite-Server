# Live Traces and saved radio observations

CartoLite retains the latest 10,000 sanitized route and observer observations for up to seven days, whichever limit is reached first. Collection runs on the server while browsers are closed. The existing atomic checkpoint saves history every five minutes and on graceful shutdown; an abrupt host failure can lose observations since the last checkpoint. Historical observations begin with this release; previously discarded browser packets cannot be recovered. Existing sampled segment history remains available separately.

`GET /api/packet-history` returns schemaVersion 2, retentionDays, limit, and packets in collection order. Each packet matches the TypeScript PacketView shape: opaque event ID, sequence, observation timestamp, normalized kind, route segments with public endpoint snapshots, or a public observer endpoint. Optional rssi (dBm, -200 through 0) and snr (dB, -100 through 100) are measurements supplied by the receiving observer, not measurements of every mapped hop. Missing measurements display "Radio readings not supplied". Message bodies, raw radio payloads, keys, hashes and private resolver details remain excluded.

Browsers merge saved history with live SSE by opaque packet ID on opening the map, foregrounding the tab and reconnecting. Recovery no longer clears the log. History is never sent into the live animation, sound, counters or follow camera. Live shows the newest 100 observations within 15 minutes; Log pages through saved observations in groups of 200. CSV exports all retained observations matching the kind filter, including available RSSI/SNR. The retention limit and history failures are visible in the panel.

The lower-left Latest packet card appears on both map views and updates independently of the log filter, pause and selected history entry. It shows packet kind colour, public route/observer name, observation age, optional radio readings and connection state. It keeps the last observation visible when traffic is quiet. On mobile, the node sheet, traces and packet card share a bounded layout; panels scroll without covering one another. The packet card is a scrolling live chat of the latest 24 events; while reading older messages it preserves the reader's position as new packets arrive. The chat control reads “Live” in green while auto-scrolling and “Not live” in red when scrolled back. Clicking it or scrolling to the newest event resumes auto-scrolling until the reader scrolls away again.

Selecting a saved route offers Fit route and Replay (illustrative) using retained endpoint coordinates. Segment timestamps under the selected event remain sampled, partial route history from `/api/route-history`, not packet-level timing or a measured RF replay.

Verification: `npm test`, `npm run build`, Go tests/vet/race and packet-history checkpoint/privacy tests. On a phone, open both panels, pause the list, confirm Latest packet continues updating, switch away and return, then reload and check the Log for the same observation IDs. Verify desktop, phone portrait and short landscape layouts.

### Verified release checkpoint - 2026-09-05

- Frontend: 130 tests passed; production TypeScript/Vite and Go image build passed.
- Backend: all Go tests and vet passed, including history retention, checkpoint restore and public-field checks. Race tests were attempted but the Pi kernel has a 39-bit VMA range unsupported by ThreadSanitizer (requires 48); run the race suite on a supported CI host.
- Isolated synthetic MQTT integration/privacy smoke passed; five observations and their radio values survived a graceful container restart with unchanged IDs.
- Live browser verification: all 15 baseline rows remained after reload and after the production restart; newer observations were merged. Latest packet continued updating while the log was paused (17 pending arrivals), and remained visible on the regular map.
- At 390x844 and 844x390, DOM bounding-box checks confirmed the node sheet, log and latest-packet card stayed within the viewport without overlap. Navigation and mobile map controls use separate rows on narrow phones.
- Implementation checkpoints: 37e6067 (history and live card), 14495a8 (responsive layout). Container healthy after deployment.

## Partial packet paths

New observations include optional `path` (ordered steps containing a sanitized `label` and optional public `node` endpoint) and `partial` in both SSE and saved PacketView records. Unknown sender/hop/receiver positions and unverified links are explicit gaps. Known nodes without coordinates retain their public name with “location unavailable”. A single unresolved hop no longer discards safe adjacent links elsewhere in the path. Raw path hashes and internal resolver details are not exposed.

The log, latest-packet card and CSV show the known path with ellipses for gaps. Selecting an event numbers its known map positions; Show known path fits them. Only adjacent, uniquely resolved, positioned endpoints passing the existing RF/distance checks produce mapped links. Animation/replay splits disconnected fragments even in the All traffic view and never crosses a gap. Older saved observer events still show the receiving node; missing historical path details cannot be reconstructed.

Packet path fitting reserves space for the desktop log panel and the mobile observation panels, including single known-node events. Live verification on September 5 confirmed a real partial Text path with numbered nodes 2, 3, 5 through 9 and an explicit unknown hop at position 4.
<<<<<<< HEAD
=======
