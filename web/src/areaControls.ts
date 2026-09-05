import { Marker, type Map as MapLibreMap, type GeoJSONSource } from 'maplibre-gl';
import { areaLink, areaPreset, loadAreaSelection, moveArea, saveAreaSelection, selectionBounds } from './areaSelection';
import { browserStorage } from './preferences';
import { parseAreaBounds, type AreaBounds } from './trafficArea';

/** Only Apply/Clear emit a selection; editing a draft never filters traffic. */
export function setupAreaControls(map: MapLibreMap, onChange: (bounds: AreaBounds | null) => void): {
  selectedBounds: () => AreaBounds | null; fit: () => void; destroy: () => void
} {
  const preset = areaPreset(import.meta.env.VITE_AREA_PRESET_ID, import.meta.env.VITE_AREA_PRESET_LABEL, import.meta.env.VITE_AREA_PRESET_BOUNDS);
  const storage = browserStorage();
  const initial = loadAreaSelection(location.search, storage, preset);
  let selected = initial.value;
  let draft: AreaBounds | null = null;
  const button = document.querySelector<HTMLButtonElement>('#area-button')!;
  const panel = document.querySelector<HTMLElement>('#area-panel')!;
  const form = document.querySelector<HTMLFormElement>('#area-form')!;
  const mode = document.querySelector<HTMLSelectElement>('#area-mode')!;
  const fields = document.querySelector<HTMLElement>('#area-fields')!;
  const inputs = ['west', 'south', 'east', 'north'].map((id) => document.querySelector<HTMLInputElement>(`#area-${id}`)!);
  const status = document.querySelector<HTMLElement>('#area-status')!;
  const error = document.querySelector<HTMLElement>('#area-error')!;
  const summary = document.querySelector<HTMLElement>('#area-summary')!;
  const clear = document.querySelector<HTMLButtonElement>('#area-clear')!;
  const link = document.querySelector<HTMLAnchorElement>('#area-link')!;
  const markers: Marker[] = [];
  const events = new AbortController();
  const options = { signal: events.signal };
  let styleReady = map.isStyleLoaded();
  if (preset) mode.add(new Option(preset.label, preset.id), 1);

  const bounds = (): AreaBounds | null => panel.hidden ? selectionBounds(selected, preset) : draft;
  const draw = (): void => {
    if (!styleReady) return;
    const area = bounds();
    const data: GeoJSON.FeatureCollection<GeoJSON.Polygon> = { type: 'FeatureCollection', features: area ? [{
      type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[
        area[0], [area[1][0], area[0][1]], area[1], [area[0][0], area[1][1]], area[0]
      ]] }
    }] : [] };
    if (!map.getSource('traffic-area')) map.addSource('traffic-area', { type: 'geojson', data });
    else (map.getSource('traffic-area') as GeoJSONSource).setData(data);
    if (!map.getLayer('traffic-area-outline')) map.addLayer({ id: 'traffic-area-outline', type: 'line', source: 'traffic-area',
      paint: { 'line-color': '#63d9cc', 'line-width': 3, 'line-dasharray': [3, 2] } });
    map.getContainer().dataset.areaBounds = area?.flat().join(',') ?? '';
  };
  const fit = (): void => {
    const area = bounds();
    if (!area) return;
    const rect = panel.getBoundingClientRect();
    const portrait = window.innerWidth < 600;
    const padding = panel.hidden ? { top: 152, right: 50, bottom: 65, left: 50 } : portrait
      ? { top: 152, right: 40, bottom: rect.height + 85, left: 40 }
      : { top: 152, right: rect.width + 40, bottom: 65, left: 45 };
    map.fitBounds(area, { padding, maxZoom: 14, duration: 0 });
  };
  const syncFields = (): void => {
    if (draft) inputs.forEach((input, i) => { input.value = String(draft!.flat()[i]); });
  };
  const positionMarkers = (): void => {
    if (!draft) return;
    const [[w, s], [e, n]] = draft;
    const positions: [number, number][] = [[w, s], [e, s], [e, n], [w, n], [(w + e) / 2, (s + n) / 2]];
    markers.forEach((marker, i) => marker.setLngLat(positions[i]!));
  };
  const removeMarkers = (): void => { markers.splice(0).forEach((marker) => marker.remove()); };
  const editMarkers = (): void => {
    removeMarkers();
    if (mode.value !== 'custom' || panel.hidden || !draft) return;
    for (const [index, name] of ['southwest', 'southeast', 'northeast', 'northwest', 'centre'].entries()) {
      const element = document.createElement('div');
      element.className = 'area-handle';
      element.textContent = index === 4 ? '✥' : '⤢';
      element.title = `Drag ${name}; coordinate fields also available`;
      // Drag targets have equivalent labelled keyboard inputs in the panel.
      element.setAttribute('aria-hidden', 'true');
      const marker = new Marker({ element, draggable: true }).setLngLat([0, 0]).addTo(map);
      marker.on('drag', () => {
        if (!draft) return;
        const { lng, lat } = marker.getLngLat();
        if (index === 4) draft = moveArea(draft, lng, lat);
        else {
          const values = draft.flat();
          values[index === 0 || index === 3 ? 0 : 2] = lng;
          values[index < 2 ? 1 : 3] = lat;
          draft = parseAreaBounds(values.join(',')) ?? draft;
        }
        error.textContent = '';
        syncFields(); positionMarkers(); draw();
      });
      markers.push(marker);
    }
    positionMarkers();
  };
  const updateSummary = (): void => {
    const label = selected === 'all' ? 'All received traffic' : selected === preset?.id ? preset.label : 'Custom area';
    summary.textContent = selected === 'all' ? label : `${label} · local observed hops`;
    clear.hidden = selected === 'all';
    button.classList.toggle('selected', selected !== 'all');
    button.title = `Area: ${label}`;
    link.href = areaLink(location.href, selected);
  };
  const close = (): void => {
    panel.hidden = true; button.setAttribute('aria-expanded', 'false');
    removeMarkers(); draw(); button.focus();
  };
  const persist = (): void => {
    status.textContent = saveAreaSelection(storage, selected) ? 'Area saved. Display updated.' : 'Area selected for this visit. Browser storage is unavailable.';
    try { history.replaceState(null, '', areaLink(location.href, selected)); }
    catch { status.textContent += ' Address could not be updated; use the area link.'; }
    updateSummary();
    onChange(selectionBounds(selected, preset));
  };
  const setDraft = (): void => {
    error.textContent = '';
    fields.hidden = mode.value !== 'custom';
    if (mode.value === 'all') draft = null;
    else if (preset && mode.value === preset.id) draft = preset.bounds;
    else {
      const view = map.getBounds();
      draft = draft ?? selectionBounds(selected, preset) ?? preset?.bounds
        ?? parseAreaBounds([Math.max(-180, view.getWest()), Math.max(-85, view.getSouth()), Math.min(180, view.getEast()), Math.min(85, view.getNorth())].join(','))
        ?? [[-10, -10], [10, 10]];
    }
    syncFields(); editMarkers(); draw(); fit();
  };
  const open = (): void => {
    panel.hidden = false; button.setAttribute('aria-expanded', 'true');
    mode.value = selected === 'all' ? 'all' : selected === preset?.id ? selected : 'custom';
    draft = selectionBounds(selected, preset);
    setDraft(); mode.focus();
  };
  const onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !panel.hidden) close();
  };
  button.addEventListener('click', () => panel.hidden ? open() : close(), options);
  mode.addEventListener('change', setDraft, options);
  form.addEventListener('input', () => {
    if (mode.value !== 'custom') return;
    const parsed = parseAreaBounds(inputs.map((input) => input.value).join(','));
    error.textContent = parsed ? '' : 'Enter valid bounds: west < east, south < north. Dateline wrapping is not supported.';
    if (parsed) { draft = parsed; positionMarkers(); draw(); }
  }, options);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (mode.value === 'custom') {
      const parsed = parseAreaBounds(inputs.map((input) => input.value).join(','));
      if (!parsed) { error.textContent = 'Check all four coordinates before applying.'; inputs[0]!.focus(); return; }
      selected = parsed.flat().join(',');
    } else selected = mode.value;
    persist(); close(); fit();
  }, options);
  document.querySelector('#area-cancel')!.addEventListener('click', close, options);
  clear.addEventListener('click', () => { selected = 'all'; persist(); close(); }, options);
  document.querySelector('#area-fit')!.addEventListener('click', fit, options);
  document.addEventListener('keydown', onEscape, options);
  // Style readiness is distinct from all tiles/sources being idle on a live map.
  const loadingStyle = (): void => { styleReady = false; };
  const loadedStyle = (): void => { styleReady = true; draw(); };
  map.on('styledataloading', loadingStyle);
  map.on('style.load', loadedStyle);
  status.textContent = initial.warning || 'Both ends of a hop must be inside. Local receptions do not prove a local packet origin. Apply to update the display.';
  updateSummary(); draw();
  return { selectedBounds: () => selectionBounds(selected, preset), fit, destroy: () => { events.abort(); panel.hidden = true; button.disabled = true; removeMarkers(); map.off('styledataloading', loadingStyle); map.off('style.load', loadedStyle); } };
}
