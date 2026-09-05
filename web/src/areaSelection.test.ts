import { afterEach, expect, it, vi } from 'vitest';
import { AREA_STORAGE_KEY, areaLink, areaPreset, loadAreaSelection, moveArea, saveAreaSelection, selectionBounds } from './areaSelection';
import { browserStorage, loadUiPreferences, DEFAULT_UI_PREFERENCES } from './preferences';
import { loadSoundPreference } from './audio';

const preset = areaPreset('test-region', 'Test region', '10,20,12,22')!;
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('validates deployment presets without inventing a geographic default', () => {
  expect(preset.bounds).toEqual([[10, 20], [12, 22]]);
  for (const id of ['', 'all', 'custom', '<script>', 'a'.repeat(33)]) expect(areaPreset(id, 'Test', '10,20,12,22')).toBeNull();
  expect(areaPreset('region', '', '10,20,12,22')).toBeNull();
  expect(areaPreset('region', 'Test', '12,20,10,22')).toBeNull();
  expect(selectionBounds('test-region', null)).toBeNull();
  expect(loadAreaSelection('', undefined, null).value).toBe('all');
});

it('restores valid saved selections, with explicit links taking precedence', () => {
  expect(saveAreaSelection(localStorage, '10,20,12,22')).toBe(true);
  expect(loadAreaSelection('', localStorage, preset).value).toBe('10,20,12,22');
  expect(loadAreaSelection('?area=test-region', localStorage, preset).value).toBe('test-region');
  expect(loadAreaSelection('?area=all', localStorage, preset).value).toBe('all');
  expect(loadAreaSelection('?area=10%2C20%2C12%2C22', undefined, preset).value).toBe('10,20,12,22');
  expect(selectionBounds('test-region', preset)).toEqual(preset.bounds);
});

it('handles invalid links and stale saved presets visibly, without reusing a hidden old filter', () => {
  localStorage.setItem(AREA_STORAGE_KEY, 'test-region');
  for (const search of ['?area=', '?area=unknown', '?area=all&area=test-region', '?area=NaN,0,1,2', '?area=170,0,-170,10']) {
    expect(loadAreaSelection(search, localStorage, preset)).toMatchObject({ value: 'all', warning: expect.stringContaining('Invalid') });
  }
  expect(loadAreaSelection('', localStorage, null).warning).toContain('Saved area');
  expect(areaLink('https://example.invalid/?foo=bar#node=n-example', 'test-region')).toBe('https://example.invalid/?foo=bar&area=test-region#node=n-example');
});

it('survives disabled reads, writes and even the browser storage getter', () => {
  const unavailable = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
  expect(loadAreaSelection('', unavailable, preset).value).toBe('all');
  expect(saveAreaSelection(unavailable, 'all')).toBe(false);
  expect(saveAreaSelection(undefined, 'all')).toBe(false);
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('blocked'); });
  expect(browserStorage()).toBeUndefined();
  expect(loadUiPreferences(browserStorage())).toEqual(DEFAULT_UI_PREFERENCES);
  expect(loadSoundPreference(browserStorage()).enabled).toBe(false);
  vi.restoreAllMocks();
});

it('moves a rectangle without resizing or wrapping beyond the renderable world', () => {
  expect(moveArea(preset.bounds, 20, 30)).toEqual([[19, 29], [21, 31]]);
  const moved = moveArea(preset.bounds, 180, 90);
  expect(moved[1]).toEqual([180, 85.051129]);
  expect(moved[1][0] - moved[0][0]).toBe(2);
  expect(moved[1][1] - moved[0][1]).toBe(2);
});
