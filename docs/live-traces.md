# Live Traces

CartoLite's Live Traces panel reuses the existing sanitized `/api/events` SSE feed. It keeps at most 1,000 accepted route or observer-only observations from the last 15 minutes and renders at most 100 rows at a time. Pause List stops list repainting while ingestion and eviction continue; a new-observation count is shown until the list resumes.

The panel exposes public event time, normalized traffic kind, route labels and mapped segment count through the existing public endpoint shapes. Observer-only events are labeled **Heard here; route unavailable**. It never publishes payloads, public or observer keys, packet hashes, raw paths, resolver reasons or message text. Selecting a route focuses its first published segment through the existing map selection state; new arrivals do not move the camera unless Live Follow is enabled.

The current filtered window can be downloaded as CSV with time, normalized kind, route/observer mode, mapped segment count and escaped public labels. The export is a convenience snapshot of this browser only, not a permalink or historical archive.

This is a live browser window, not historical replay. Reconnect or sequence recovery clears the trace window. Route length, RF distance, delivery, latency and unique-transmission claims are intentionally unsupported.
