# Data sources

## Operator MQTT broker

All topology and activity originate from the operator-configured MeshCore MQTT feed. The server sends no traffic to a shared CartoLite service. MQTT credentials stay inside the server container environment and are never returned by an endpoint.

## CARTO vector basemap

The browser uses a minimal CARTO vector style for land, water, boundaries, roads, and place labels. Each operator supplies a CARTO Basemaps API key during the image build. The client makes normal TileJSON, vector PBF, and glyph requests directly to CARTO. There is no raster basemap fallback.

## Optional terrain

Topography and 3D use Mapterhorn's public TileJSON endpoint at `https://tiles.mapterhorn.com/tilejson.json`. MapLibre reads its Terrarium elevation tiles only after a visitor enables Topography or 3D. No MQTT data or visitor identifier is added to those requests.

No country, regional-boundary, geocoding, weather, analytics, or history source is bundled.

## Measured signal data

Coverage derives only from eligible MQTT receptions and saved sanitized measurements. Signal values belong to the reporting receiver's final radio hop; earlier mapped hops are not additional RF measurements. Existing topology coordinates provide last-known snapshots with age flags. Historical summaries are collected locally, with the bounds documented in [the coverage plan](signal-coverage-plan.md).

No propagation predictions are currently produced. The optional terrain visualization is not an RF model. Stage 5 requires confirmed radio/antenna inputs and a suitable terrain source before predictions can be enabled.
