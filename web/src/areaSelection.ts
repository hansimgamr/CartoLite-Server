import { parseAreaBounds, type AreaBounds } from './trafficArea';

export const AREA_STORAGE_KEY = 'cartolite-server:area:v1';
export interface AreaPreset { id: string; label: string; bounds: AreaBounds }

export function areaPreset(id: unknown, label: unknown, rawBounds: unknown): AreaPreset | null {
  const bounds = parseAreaBounds(rawBounds);
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(id) || ['all', 'custom'].includes(id)
    || typeof label !== 'string' || !label.trim() || label.length > 60 || !bounds) return null;
  return { id, label: label.trim(), bounds };
}

export function selectionBounds(value: string, preset: AreaPreset | null): AreaBounds | null {
  return preset && value === preset.id ? preset.bounds : parseAreaBounds(value);
}

function validSelection(value: unknown, preset: AreaPreset | null): value is string {
  return typeof value === 'string' && (value === 'all' || selectionBounds(value, preset) !== null);
}

export function loadAreaSelection(search: string, storage: Storage | undefined, preset: AreaPreset | null): { value: string; warning: string } {
  const params = new URLSearchParams(search);
  const links = params.getAll('area');
  if (links.length) {
    return links.length === 1 && validSelection(links[0], preset)
      ? { value: links[0], warning: '' }
      : { value: 'all', warning: 'Invalid or unavailable area link. Showing all received traffic.' };
  }
  try {
    const saved = storage?.getItem(AREA_STORAGE_KEY);
    if (validSelection(saved, preset)) return { value: saved, warning: '' };
    if (saved !== null && saved !== undefined) return { value: 'all', warning: 'Saved area is invalid or unavailable. Showing all received traffic.' };
  } catch { /* Preferences are optional. */ }
  return { value: 'all', warning: '' };
}

export function saveAreaSelection(storage: Storage | undefined, value: string): boolean {
  try {
    if (!storage) return false;
    storage.setItem(AREA_STORAGE_KEY, value);
    return true;
  } catch { return false; }
}

/** Preserve unrelated query parameters and a node deep link. */
export function areaLink(href: string, value: string): string {
  const url = new URL(href);
  url.searchParams.set('area', value);
  return url.href;
}

export function moveArea(bounds: AreaBounds, lng: number, lat: number): AreaBounds {
  const halfWidth = (bounds[1][0] - bounds[0][0]) / 2;
  const halfHeight = (bounds[1][1] - bounds[0][1]) / 2;
  const x = Math.max(-180 + halfWidth, Math.min(180 - halfWidth, lng));
  const y = Math.max(-85.051129 + halfHeight, Math.min(85.051129 - halfHeight, lat));
  return [[x - halfWidth, y - halfHeight], [x + halfWidth, y + halfHeight]];
}
