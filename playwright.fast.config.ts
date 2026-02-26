import baseConfig from './playwright.config';
import { defineConfig } from '@playwright/test';

// Fast profile for quick feedback during game validation loops.
export default defineConfig({
  ...(baseConfig as any),
  retries: 0,
  reporter: [['list']],
  use: {
    ...((baseConfig as any).use ?? {}),
    trace: 'off',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 20 * 1000,
    navigationTimeout: 25 * 1000,
  },
  projects: [
    {
      ...(baseConfig as any).projects?.find((p: any) => p.name === 'chromium-desktop'),
      name: 'chromium-desktop',
    },
  ],
});
