import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for Betway Login
 */
export class LoginPage {
  readonly page: Page;

  // Login form elements
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly loginLink: Locator;

  // Error messages
  readonly errorMessage: Locator;

  // User menu (when logged in)
  readonly userMenu: Locator;
  readonly balanceDisplay: Locator;

  constructor(page: Page) {
    this.page = page;

    // Login form locators based on actual Betway HTML
    this.usernameInput = page.locator('#header-username');
    this.passwordInput = page.locator('#header-password');
    this.loginButton = page.locator('#login-btn');
    this.loginLink = page.locator('#login-btn');

    this.errorMessage = page.locator('.text-error-600, [class*="error"]');

    this.userMenu = page.locator('[class*="user-menu"], [class*="account"], [data-testid="user-menu"]');
    this.balanceDisplay = page.locator('[class*="balance"], [data-testid="balance"]');
  }

  /**
   * Navigate to home page
   */
  async gotoHome() {
    await this.page.goto('/');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
  }

  /**
   * Login with credentials from header form
   */
  async login(username: string, password: string): Promise<boolean> {
    try {
      // First dismiss any overlays (cookie banners, etc.)
      await this.dismissOverlays();

      // Check if already logged in
      if (await this.isLoggedIn()) {
        console.log('Already logged in');
        return true;
      }

      // Click the Login button in header to expand/reveal the login form fields
      const loginBtn = this.page.locator('#login-btn');
      if (await loginBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await loginBtn.click();
        console.log('Clicked Login button to reveal form');
        await this.page.waitForTimeout(1000);
      }

      // Wait for username input to be visible
      await this.usernameInput.waitFor({ state: 'visible', timeout: 10000 });

      // Clear and fill username (mobile number)
      await this.usernameInput.click();
      await this.usernameInput.clear();
      await this.usernameInput.fill(username);
      console.log('Filled mobile number:', username);

      // Clear and fill password
      await this.passwordInput.click();
      await this.passwordInput.clear();
      await this.passwordInput.fill(password);
      console.log('Filled password');

      // Click Login button again to submit the form
      await this.loginButton.click();
      console.log('Clicked Login button to submit');

      // Wait for login to complete - look for user menu or balance to appear
      // Login happens via AJAX, so we wait for success indicators instead of page reload
      try {
        await this.page.waitForSelector('[class*="user-menu"], [class*="account"], [class*="balance"], [class*="logged"]', {
          state: 'visible',
          timeout: 15000
        });
        console.log('Login success: user menu/balance visible');
        return true;
      } catch {
        // If no success indicator, wait a bit and check
        await this.page.waitForTimeout(3000);
        const success = await this.isLoggedIn();
        console.log('Login success:', success);
        return success;
      }
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  }

  /**
   * Handle login popup that appears after clicking Play on a game
   * This popup appears when user is not logged in and tries to play a game
   */
  async handleLoginPopup(username: string, password: string): Promise<boolean> {
    try {
      console.log('Waiting for login popup...');

      // Wait for popup to appear - look for common popup/modal selectors
      const popupSelectors = [
        'div[class*="modal"]',
        'div[class*="popup"]',
        'div[class*="dialog"]',
        'div.fixed[class*="z-"]',
        '[role="dialog"]',
      ];

      let popupFound = false;
      for (const selector of popupSelectors) {
        const popup = this.page.locator(selector).first();
        if (await popup.isVisible({ timeout: 5000 }).catch(() => false)) {
          popupFound = true;
          break;
        }
      }

      if (!popupFound) {
        console.log('No login popup detected, might already be logged in');
        return true;
      }

      // Look for username/mobile input in the popup
      const mobileInputSelectors = [
        'input[placeholder*="Mobile" i]',
        'input[placeholder*="Phone" i]',
        'input[type="tel"]',
        'input[id*="username" i]',
        'input[id*="mobile" i]',
        'input[name*="username" i]',
        'input[name*="mobile" i]',
      ];

      let mobileInput = null;
      for (const selector of mobileInputSelectors) {
        const input = this.page.locator(selector).first();
        if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
          mobileInput = input;
          break;
        }
      }

      if (!mobileInput) {
        console.error('Mobile number input not found in popup');
        return false;
      }

      // Fill mobile number
      await mobileInput.click();
      await mobileInput.clear();
      await mobileInput.fill(username);
      console.log('Filled mobile number');

      // Look for password input in the popup
      const passwordInputSelectors = [
        'input[type="password"]',
        'input[placeholder*="Password" i]',
        'input[id*="password" i]',
        'input[name*="password" i]',
      ];

      let passwordInput = null;
      for (const selector of passwordInputSelectors) {
        const input = this.page.locator(selector).first();
        if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
          passwordInput = input;
          break;
        }
      }

      if (!passwordInput) {
        console.error('Password input not found in popup');
        return false;
      }

      // Fill password
      await passwordInput.click();
      await passwordInput.clear();
      await passwordInput.fill(password);
      console.log('Filled password');

      // Look for login/submit button in the popup
      const submitButtonSelectors = [
        'button[type="submit"]',
        'button:has-text("Login")',
        'button:has-text("Log In")',
        'button:has-text("Sign In")',
        'button:has-text("Submit")',
        'input[type="submit"]',
      ];

      let submitButton = null;
      for (const selector of submitButtonSelectors) {
        const button = this.page.locator(selector).first();
        if (await button.isVisible({ timeout: 2000 }).catch(() => false)) {
          submitButton = button;
          break;
        }
      }

      if (submitButton) {
        await submitButton.click();
        console.log('Clicked submit button');
      } else {
        // Fallback: press Enter
        await passwordInput.press('Enter');
        console.log('Pressed Enter to submit');
      }

      // Wait for login to complete
      await this.page.waitForLoadState('domcontentloaded');
      await this.page.waitForTimeout(3000);

      // Check if login was successful
      const success = await this.isLoggedIn();
      console.log('Login success:', success);
      return success;
    } catch (error) {
      console.error('Login popup handling failed:', error);
      return false;
    }
  }

  /**
   * Open the login form/modal if it's not visible
   */
  async openLoginForm(): Promise<void> {
    // Common login trigger buttons/links
    const loginTriggers = [
      'button:has-text("Login")',
      'button:has-text("Log In")',
      'button:has-text("Sign In")',
      'a:has-text("Login")',
      'a:has-text("Log In")',
      'a:has-text("Sign In")',
      '[data-testid="login-button"]',
      '[class*="login-btn"]',
      '[class*="signin"]',
      '#login-trigger',
      '.login-trigger',
    ];

    for (const selector of loginTriggers) {
      const trigger = this.page.locator(selector).first();
      if (await trigger.isVisible({ timeout: 1000 }).catch(() => false)) {
        await trigger.click();
        await this.page.waitForTimeout(1000);

        // Check if login form is now visible
        if (await this.usernameInput.isVisible().catch(() => false)) {
          return;
        }
      }
    }

    // If still not visible, try clicking on header area where login typically is
    const headerLogin = this.page.locator('header button, header a').filter({ hasText: /login|sign in/i }).first();
    if (await headerLogin.isVisible().catch(() => false)) {
      await headerLogin.click();
      await this.page.waitForTimeout(1000);
    }
  }

  /**
   * Dismiss any overlays like cookie consent banners
   */
  async dismissOverlays(): Promise<void> {
    const dismissButtons = [
      'button[aria-label="Got it"]',
      'button:has-text("Got it")',
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("OK")',
      '.cookie-banner button',
      '[class*="cookie"] button',
      '[class*="consent"] button',
    ];

    for (const selector of dismissButtons) {
      const button = this.page.locator(selector).first();
      if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
        await button.click().catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }
  }

  /**
   * Login with environment variables
   */
  async loginWithEnvCredentials(): Promise<boolean> {
    const username = process.env.BETWAY_USERNAME;
    const password = process.env.BETWAY_PASSWORD;

    if (!username || !password) {
      console.warn('Login credentials not found in environment variables');
      return false;
    }

    await this.gotoHome();
    return await this.login(username, password);
  }

  /**
   * Check if user is logged in
   */
  async isLoggedIn(): Promise<boolean> {
    try {
      // Check for user menu or balance display
      const userMenuVisible = await this.userMenu.isVisible().catch(() => false);
      const balanceVisible = await this.balanceDisplay.isVisible().catch(() => false);

      return userMenuVisible || balanceVisible;
    } catch {
      return false;
    }
  }

  /**
   * Get error message if login failed
   */
  async getErrorMessage(): Promise<string | null> {
    try {
      if (await this.errorMessage.isVisible()) {
        return await this.errorMessage.textContent();
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    try {
      await this.userMenu.click();
      await this.page.waitForTimeout(500);

      const logoutButton = this.page.locator('button:has-text("Logout"), a:has-text("Logout"), button:has-text("Sign Out")');
      if (await logoutButton.isVisible()) {
        await logoutButton.click();
        await this.page.waitForLoadState('networkidle');
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  }
}
