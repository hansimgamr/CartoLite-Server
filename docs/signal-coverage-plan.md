# Repeater Signal Coverage Overlay Plan

Add **Measured signal** to each repeater first, then introduce **Predicted coverage** once the inputs and measurements are available to validate it.

## Progress

Stage 1 implemented and deployed: explicit final-hop measurement snapshots. Stage 2 is next.

Checkpoint validation (2026-09-05): Go tests and vet passed; all 132 frontend tests and frontend/container builds passed; isolated synthetic MQTT integration/privacy smoke passed; `git diff --check` passed. Go race checks were attempted but cannot execute on the Pi kernel (`ThreadSanitizer: unsupported VMA range`, found 39, supports 48); rerun on a supported CI host. The deployed container is healthy. Initial direct service API verification found 2,866 retained observations, including four newly captured measurements with final transmitters. Public HTTPS verification from the Pi returned 403; direct service verification succeeded.
No coverage markers or prediction layer are enabled yet.

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
