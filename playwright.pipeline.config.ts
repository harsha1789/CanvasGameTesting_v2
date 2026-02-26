import baseConfig from './playwright.config';
import { defineConfig } from '@playwright/test';

// Pipeline runs hit slow external canvas games; use larger action/navigation timeouts
// to avoid flaky `page.screenshot()` timeouts (fonts/load).
export default defineConfig({
  ...(baseConfig as any),
  use: {
    ...((baseConfig as any).use ?? {}),
    actionTimeout: 60 * 1000,
    navigationTimeout: 60 * 1000,
  },
});

