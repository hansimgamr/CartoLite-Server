import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Isolated, synthetic UI checks; no broker, production server or tile key.
export default defineConfig({
  ...base,
  testMatch: /area-controls\.spec\.ts/,
  projects: [
    ...base.projects!.map(({ name, use }) => ({ name, use })),
    { name: 'small-phone', use: { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true } }
  ],
  workers: 1,
  use: { ...base.use, baseURL: 'http://127.0.0.1:39477', launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: {
    command: 'npm run dev -- --port 39477 --strictPort',
    url: 'http://127.0.0.1:39477',
    env: { VITE_AREA_PRESET_ID: 'test-region', VITE_AREA_PRESET_LABEL: 'Test region', VITE_AREA_PRESET_BOUNDS: '10,20,12,22',
      VITE_CARTO_BASEMAP_API_KEY: '', VITE_CARTO_TILE_BASE: '', VITE_HOME_BOUNDS: '', VITE_STATUS_CONSOLE_ORIGIN: '' },
    reuseExistingServer: false
  }
});
