import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Betway automation testing
 * Supports multi-regional testing and various device configurations
 */
export default defineConfig({
  testDir: './tests',
  
  // Maximum time one test can run (2 minutes for slow game loads)
  timeout: 120 * 1000,
  
  // Test execution settings
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  
  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'reports/html' }],
    ['json', { outputFile: 'reports/results.json' }],
    ['junit', { outputFile: 'reports/junit.xml' }],
    ['list']
  ],
  
  // Shared test configuration
  use: {
    // Base URL for Betway South Africa
    baseURL: process.env.BASE_URL || 'https://www.betway.co.za',
    
    // Browser context options
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // Navigation timeout
    navigationTimeout: 30 * 1000,
    
    // Action timeout
    actionTimeout: 15 * 1000,
    
    // Viewport - Dell laptop resolution
    viewport: { width: 1366, height: 768 },
    
    // Locale and timezone
    locale: 'en-ZA',
    timezoneId: 'Africa/Johannesburg',
    
  },

  // Project configurations for different browsers and regions
  projects: [
    // Desktop browsers
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 },
        permissions: ['clipboard-read', 'clipboard-write'],
      },
    },
    {
      name: 'firefox-desktop',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1366, height: 768 }
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1366, height: 768 }
      },
    },

    // Mobile devices
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'tablet-chrome',
      use: { ...devices['iPad Pro'] },
    },

    // Regional configurations (example for future expansion)
    {
      name: 'betway-za',
      use: {
        baseURL: 'https://www.betway.co.za',
        locale: 'en-ZA',
        timezoneId: 'Africa/Johannesburg',
      },
    },
    {
      name: 'betway-ng',
      use: {
        baseURL: 'https://www.betway.com.ng',
        locale: 'en-NG',
        timezoneId: 'Africa/Lagos',
      },
    },
    {
      name: 'betway-ke',
      use: {
        baseURL: 'https://www.betway.co.ke',
        locale: 'en-KE',
        timezoneId: 'Africa/Nairobi',
      },
    },
  ],

  // Web server configuration (if needed for local testing)
  webServer: process.env.START_SERVER ? {
    command: 'npm run serve',
    port: 3000,
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  } : undefined,
});
