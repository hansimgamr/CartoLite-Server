# Live Traces

CartoLite's Live Traces panel reuses the existing sanitized `/api/events` SSE feed. It keeps at most 1,000 accepted route or observer-only observations from the last 15 minutes and renders at most 100 rows at a time. Pause List stops list repainting while ingestion and eviction continue; a new-observation count is shown until the list resumes.

The panel exposes public event time, normalized traffic kind, route labels and mapped segment count through the existing public endpoint shapes. Observer-only events are labeled **Heard here; route unavailable**. It never publishes payloads, public or observer keys, packet hashes, raw paths, resolver reasons or message text. Selecting a route focuses its first published segment through the existing map selection state; new arrivals do not move the camera unless Live Follow is enabled.

The current filtered window can be downloaded as CSV with time, normalized kind, route/observer mode, mapped segment count and escaped public labels. The export is a convenience snapshot of this browser only, not a permalink or historical archive.

Mapped route timestamps are retained in the server checkpoint for up to seven days, with a bounded sample per route. `GET /api/route-history?routes=<id,...>` returns only requested opaque route IDs and receipt times, plus `partial: true`; the inspector uses it to show selected-segment activity. This is route observation history, not reconstructed packet replay or RF distance.

When a route is selected, **Fit route** moves the map to the packet's published endpoints. **Replay (illustrative)** animates the selected observation through the map animator; it is a visual aid and does not alter live counters, route history or follow mode.

This is a live browser window, not historical replay. Reconnect or sequence recovery clears the trace window. Route length, RF distance, delivery, latency and unique-transmission claims are intentionally unsupported.
