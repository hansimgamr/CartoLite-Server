# Repeater Signal Coverage Overlay Plan

Add **Measured signal** to each repeater first, then introduce **Predicted coverage** once the inputs and measurements are available to validate it.

## Progress

Stage 1 implemented and deployed: explicit final-hop measurement snapshots. Stage 2 summaries are implemented; Stage 3 map controls and markers are implemented; Stage 4 retention is next.

Stage 1 checkpoint validation (2026-09-05): Go tests and vet passed; all 132 frontend tests and frontend/container builds passed; isolated synthetic MQTT integration/privacy smoke passed; `git diff --check` passed. Go race checks were attempted but cannot execute on the Pi kernel (`ThreadSanitizer: unsupported VMA range`, found 39, supports 48); rerun on a supported CI host. The deployed container is healthy. Initial direct service API verification found 2,866 retained observations, including four newly captured measurements with final transmitters. Public HTTPS verification from the Pi returned 403; direct service verification succeeded.
At the Stage 1 checkpoint no coverage markers were enabled. Measured markers are now available (Stage 3), with persistent aggregates (Stage 4); prediction remains unimplemented. Earlier checkpoint sections below describe their original release behavior; Stage 4 supersedes raw-only summary retention and exact medians.

### Stage 1 data audit and attribution contract

- MQTT normalization accepts RSSI/SNR, reporting receiver identity, optional coordinates, and a packet timestamp within five minutes of arrival (otherwise server arrival time). RSSI/SNR describe reception at that receiver, never all links in a route.
- New public packet/history records optionally include `measurement`: receiver snapshot, optional transmitter snapshot, coordinate-report timestamps, and `locationQuality: last-known`. The packet's `at`, `rssi`, and `snr` apply to this reception. Only sanitized public node IDs and labels are exposed.
- Resolve the actual last packet-path identity, requiring a unique match across all node roles and a forwarding role. For zero-hop packets, use the existing source identity resolver. Require the final transmitter-to-receiver segment to pass existing route gates. Earlier unknown hops do not disqualify an otherwise known final hop; a final gap cannot borrow an earlier segment.
- Receiver-only measurements remain unattributed and must be excluded from pairwise coverage summaries. Missing RF yields no measurement. Packets without a located receiver cannot supply coverage measurements; the existing packet display may still show earlier mapped segments.
- Coordinates are snapshots of the latest report known during ingestion, not proof of location at packet time. `receiverLocationAt` and `transmitterLocationAt` identify those reports; absent timestamps mean unknown age (including topology loaded from older checkpoints). Stage 2 must flag missing, stale, or newer-than-packet reports. Do not interpolate locations or imply GPS accuracy.
- Incoming/outgoing views will select the receiver/transmitter respectively; this does not establish a reverse-direction measurement.
- Older packets without `measurement` stay readable but are excluded from verified coverage. Their paths may collapse duplicate nodes and route records do not explicitly establish receiver identity, so backfilling would risk incorrect attribution.
- Retention remains 10,000 observations or seven days, whichever comes first. Persistent long-term summaries are Stage 4. Duplicate reception handling is Stage 2; raw counts must not yet be advertised as unique transmissions or delivery rates.
- Synthetic regression coverage checks final-hop attribution across earlier gaps, unresolved final hops, identity collisions, missing RF, immutable location snapshots, restart persistence, and checkpoint endpoint validation.

## Stage 1 — Verify and preserve measurement data

Audit incoming MQTT observations and saved history for receiver identity, coordinates, RSSI, SNR, timestamp, and immediate transmitting node.

- Attribute signal readings only to the final radio hop into the reporting receiver.
- Exclude ambiguous transmitter identities from coverage calculations.
- Keep incoming and outgoing measurements separate.
- Preserve the coordinates applicable to each observation; flag missing or uncertain locations.
- Identify which older observations are safe to reuse.

**Checkpoint:** Document available fields, attribution rules, and historical limitations. Add checks that reject incorrect hop attribution.

## Stage 2 — Build measured-signal summaries

Aggregate eligible observations by selected repeater, direction, receiver location, and time window.

Each summary includes:

- Median RSSI and SNR, plus their variation.
- Sample count and first/last observation.
- Measurement age and location quality.
- Explicit reasons when data cannot be used.

Offer **1 hour, 24 hours, and 7 days** initially. Keep areas without measurements unknown. Do not calculate delivery percentages from received packets alone.

**Checkpoint:** Compare summaries against individual saved observations and verify that duplicate reception records do not inflate counts.

## Stage 3 — Add the map overlay

Add a **Signal coverage** button to the selected repeater's information panel on both maps.

The overlay provides:

- **Heard this repeater** and **Heard by this repeater** directions.
- Coloured measurement markers with an RSSI/SNR selector.
- A labelled scale with units.
- Details showing signal variation, samples, and last heard.
- A clear **Not enough measurements** state.

Use colour for signal level and a separate visual indicator for sparse or stale measurements. Avoid drawing a filled coverage region between isolated receivers.

**Checkpoint:** Check desktop and mobile layouts, map interaction, readability, and panel overlap.

## Stage 4 — Retain useful coverage history

Create bounded, persistent measurement summaries so coverage does not disappear when raw packet history reaches its retention limit.

- Store counts and signal distributions sufficient for the displayed statistics.
- Preserve direction and location changes.
- Keep live updates incremental.
- Document retention and aggregation precision, including whether medians are approximate.

**Checkpoint:** Verify reloads and service restarts preserve results. Measure storage and query costs on the Pi.

## Stage 5 — Add optional predicted coverage

Collect or confirm:

- Frequency and LoRa settings.
- Transmit power, antenna gain, and cable loss.
- Antenna height above ground.
- Receiving antenna assumptions.
- Suitable terrain data.

Evaluate Longley–Rice/ITM for the region and generate a cached coverage layer. Label it **Predicted coverage**, show its assumptions, and keep it visually distinct from measurements. Missing inputs must be disclosed rather than silently invented.

**Checkpoint:** Validate model inputs and runtime before enabling predictions publicly.

## Stage 6 — Validate in the field

Use a receiving node at known locations around selected repeaters.

- Record location, radio setup, transmissions attempted, and packets received.
- Sample different distances, directions, terrain, and obstructed locations.
- Compare predicted signal with measurements reserved for validation.
- Report prediction error and coverage gaps.

**Checkpoint:** Publish measured limitations alongside the overlay.

## Delivery workflow

At every stage:

1. Run relevant checks.
2. Update documentation with results, limitations, and the next step.
3. Commit and push a resumable checkpoint.
4. Verify deployed changes on the Pi, treating the live Pi repository as the source of truth.

**Stages 1–4 deliver the measured overlay. Stages 5–6 add a validated coverage prediction.**

## Research references

- [MeshCore MQTT capture format](https://github.com/Cisien/meshcoretomqtt)
- [NTIA Irregular Terrain Model / Longley–Rice](https://its.ntia.gov/software/itm/)
- [ITU-R P.1812 propagation prediction](https://www.itu.int/rec/R-REC-P.1812/en)
- [Semtech LoRa technical FAQ](https://www.semtech.com/design-support/faq/faq-lora)

## Stage 2 checkpoint — measured summaries

`GET /api/signal-coverage?node=n-...&direction=outgoing&window=24h`

All three parameters are required. Directions are `outgoing` (heard this repeater) and `incoming` (heard by this repeater); windows are `1h`, `24h`, `7d`. The endpoint is available for public node IDs, including companion nodes, without inventing reverse-direction readings. An unknown ID returns an empty list. Responses are uncached and derived from bounded saved history; `partial: true` always applies. There is no map UI change until Stage 3.

- Group by transmitter/receiver IDs, both coordinate snapshots, and location quality. Position changes are separate groups, never merged into an artificial measurement location.
- `samples`, `firstAt`, `lastAt`, and `ageMs` describe retained reception records. RSSI (dBm) and SNR (dB) independently provide count, exact median, minimum, and maximum. An absent metric stays absent; it is not zero.
- `locationQuality` is `last-known`, `unknown-age` when either report timestamp is missing, or `stale` when either report predates reception by more than 24 hours. This threshold is a display flag, not an RF accuracy guarantee. Locations reported after a packet are excluded.
- `excluded` counts selected-node records with an unattributed transmitter, a newer-than-packet location, missing radio readings, or duplicate reception. `unassigned` counts window-wide records whose selected endpoint cannot be established; it must not be presented as that node's missing traffic. Historical packets without measurements cannot be assigned safely.
- Duplicate detection collapses matching transmitter, receiver, millisecond timestamp, kind, RSSI, and SNR. Separate receivers and separate timestamps count independently. No raw data or packet hashes are retained or exposed. This conservative rule can collapse two indistinguishable receptions within one millisecond; copies with changed timestamps cannot be detected. Counts are not unique transmissions or delivery percentages.
- The query scans at most 10,000 retained records and sorts values for exact statistics. No cache/database/dependency is added. Stage 4 will extend retention using persistent aggregates.

Regression checks cover statistics, independent metrics, directions, windows, location changes/age, future-location exclusion, duplicate reception, separate receivers, and invalid API parameters. Stage 3 should label sparse and stale groups separately and leave unmeasured space unknown.

Stage 2 validation (2026-09-05): Go tests/vet, 132 frontend tests, frontend/container builds, and isolated MQTT integration/privacy smoke passed. Deployed container healthy. Independent Python comparison against 3,064 retained observations verified three returned groups across six direction/window queries, including exact median/min/max and counts. Race execution remains blocked by the Pi kernel VMA limitation documented above. Stage 3 is next.

## Stage 3 checkpoint — measured map overlay

Select a repeater or room server and choose **Signal coverage**. This uses the shared map implementation, including the normal map and Live Traces view. Choose **Heard this repeater** (markers at receivers) or **Heard by this repeater** (markers at transmitters), 1 hour/24 hours/7 days, and RSSI or SNR. The backend remains the source of the summary values.

Markers show median signal using four labelled bands: RSSI below -120, -120 to -105, -105 to -90, and at least -90 dBm; SNR below -10, -10 to 0, 0 to 10, and at least 10 dB. These are display bands, not receiver sensitivity or delivery thresholds. A white ring indicates fewer than three metric readings; faded markers indicate stale or unknown-age locations. Only measured points are drawn, with no interpolated coverage region.

Click a marker or use the accessible measurement selector to inspect direction, median/range (median now approximate under Stage 4), count, first/latest timestamps, and location quality. The selector also makes coincident markers individually accessible. Empty history and missing metrics explicitly say there are not enough measurements; request failures show a retry status. Requests refresh every 30 seconds while open and are cancelled when controls change or coverage closes. Selecting another node clears the overlay. Basemap style reloads restore markers.

The coverage panel replaces node details while open and shares the mobile observation area with packet chat. In phone landscape the two panels use separate columns; desktop chat narrows while coverage is open to avoid overlap. Closing coverage restores the normal layout.

Validation: 133 frontend tests, TypeScript/Vite build, Go tests/vet, container build, and isolated MQTT integration/privacy smoke passed. Browser checks cover desktop and portrait/landscape mobile, including the empty state and viewport bounds; a landscape grid issue found during review was corrected. The existing Pi race-check limitation remains (no backend changes in this stage).

Final Stage 3 browser check: the corrected 844×390 landscape coverage panel measured 410×312 pixels, stayed within the viewport beside packet chat, and displayed a retained measurement group without JavaScript errors. Desktop 1440×900 and portrait 390×844 empty-state checks also stayed within bounds. Screenshots were reviewed locally and are not committed because they contain live labels. Service health is healthy. Stage 4 is next.
