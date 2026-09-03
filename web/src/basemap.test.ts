import { describe, expect, it } from 'vitest';
import { cartoVectorRequestURL, cartoVectorStyle } from './basemap';

describe('CARTO vector basemap', () => {
  it('contains only vector geography and no raster or PNG fallback', () => {
    const style = cartoVectorStyle('test key');
    const serialized = JSON.stringify(style);

    expect(style.sources.carto).toMatchObject({
      type: 'vector',
      url: 'https://tiles.basemaps.cartocdn.com/vector/carto.streets/v1/tiles.json?key=test%20key'
    });
    expect(style.glyphs).toBe('https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf?key=test%20key');
    expect(style.layers.some((layer) => layer.type === 'raster')).toBe(false);
    expect(serialized).not.toContain('.png');
    expect(serialized).not.toContain('dark_all');
  });

  it('routes geography through a same-origin proxy without a browser-visible key', () => {
    const style = cartoVectorStyle('test key', '/carto-tiles');
    const serialized = JSON.stringify(style);

    // Inlined tiles, not a TileJSON url: CARTO's TileJSON answers with absolute
    // cartocdn.com tile URLs, which would bypass the proxy entirely.
    expect(style.sources.carto).toMatchObject({
      type: 'vector',
      tiles: ['/carto-tiles/vectortiles/carto.streets/v1/{z}/{x}/{y}.mvt'],
      minzoom: 0,
      maxzoom: 14
    });
    expect(style.sources.carto).not.toHaveProperty('url');
    expect(style.glyphs).toBe('/carto-tiles/fonts/{fontstack}/{range}.pbf');
    // The whole point: no credential and no third-party host reach the browser.
    expect(serialized).not.toContain('test key');
    expect(serialized).not.toContain('test%20key');
    expect(serialized).not.toContain('cartocdn.com');
    expect(style.layers.some((layer) => layer.type === 'raster')).toBe(false);
  });

  it('ignores a trailing slash on the proxy base so paths never double up', () => {
    const style = cartoVectorStyle('', '/carto-tiles/');
    expect(style.glyphs).toBe('/carto-tiles/fonts/{fontstack}/{range}.pbf');
  });

  it('adds the browser-visible project key to CARTO PBF requests only once', () => {
    const tile = 'https://tiles-a.basemaps.cartocdn.com/vectortiles/carto.streets/v1/4/3/5.mvt';
    expect(cartoVectorRequestURL(tile, 'test key')).toBe(`${tile}?key=test+key`);
    expect(cartoVectorRequestURL(`${tile}?key=already`, 'test key')).toBe(`${tile}?key=already`);
    expect(cartoVectorRequestURL('https://example.com/map.mvt', 'test key')).toBe('https://example.com/map.mvt');
  });

  it('keeps all required calm-observatory geography layers', () => {
    const ids = cartoVectorStyle().layers.map((layer) => layer.id);
    expect(ids).toEqual(expect.arrayContaining([
      'basemap-landcover',
      'basemap-water',
      'basemap-country-boundary',
      'basemap-region-boundary',
      'basemap-major-roads',
      'basemap-city-labels',
      'basemap-town-labels'
    ]));
  });

  it('keeps national labels readable without repeating tile-edge water names', () => {
    const style = cartoVectorStyle();
    expect(style.layers.find((layer) => layer.id === 'basemap-water-labels')).toMatchObject({
      minzoom: 5.5,
      layout: {
        'symbol-avoid-edges': true,
        'text-allow-overlap': false
      }
    });
    expect(style.layers.find((layer) => layer.id === 'basemap-city-labels')).toMatchObject({
      minzoom: 3.25,
      layout: { 'symbol-avoid-edges': true }
    });
    expect(style.layers.find((layer) => layer.id === 'basemap-town-labels')).toMatchObject({ minzoom: 6 });
  });
});
