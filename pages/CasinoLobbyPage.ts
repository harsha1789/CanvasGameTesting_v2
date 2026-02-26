import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for Betway Casino Lobby
 * Updated selectors to match actual Betway HTML structure
 */
export class CasinoLobbyPage {
  readonly page: Page;

  // Main navigation
  readonly casinoTab: Locator;
  readonly slotsTab: Locator;
  readonly liveGamesTab: Locator;
  readonly tableGamesTab: Locator;

  // Search and filters
  readonly searchInput: Locator;
  readonly filterButtons: Locator;
  readonly categoryFilters: Locator;

  // Game grid - Updated to match actual Betway HTML structure
  readonly gameCards: Locator;
  readonly gameNames: Locator;
  readonly playButtons: Locator;
  readonly demoButtons: Locator;

  // Pagination
  readonly loadMoreButton: Locator;
  readonly paginationButtons: Locator;

  constructor(page: Page) {
    this.page = page;

    // Initialize locators
    this.casinoTab = page.locator('[href*="casino"]').first();
    this.slotsTab = page.locator('[href*="slots"]').first();
    this.liveGamesTab = page.locator('[href*="live"]').first();
    this.tableGamesTab = page.locator('[href*="table"]').first();

    this.searchInput = page.locator('input[type="search"], input[placeholder*="Search"]');
    this.filterButtons = page.locator('.filter-button, [class*="filter"]');
    this.categoryFilters = page.locator('.category-filter, [data-category]');

    // Game elements - Updated selectors for actual Betway grid structure
    // Game cards are divs with rounded-lg and contain game image + info
    this.gameCards = page.locator('div.rounded-lg.overflow-hidden').filter({ has: page.locator('img[alt]') });
    // Game names are in the footer div with text-ellipsis class
    this.gameNames = page.locator('div.text-ellipsis.font-bold, div.mb-1.overflow-hidden.text-xs.font-bold');
    // Play buttons are inside anchor tags with game URLs
    this.playButtons = page.locator('a[href*="/lobby/casino-games/game/"] button[aria-label="Play"], a[href*="/game/"] button:has-text("Play")');
    this.demoButtons = page.locator('button:has-text("Demo"), a:has-text("Demo"), button:has-text("Try")');

    this.loadMoreButton = page.locator('button:has-text("Load More"), button:has-text("Show More")');
    this.paginationButtons = page.locator('.pagination button, nav[aria-label="pagination"] button');
  }

  /**
   * Navigate to casino lobby
   */
  async goto() {
    await this.page.goto('/lobby/casino-games');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
  }

  /**
   * Navigate to slots section
   */
  async gotoSlots() {
    await this.page.goto('/lobby/casino-games/slots');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
  }

  /**
   * Navigate to live games section
   */
  async gotoLiveGames() {
    await this.page.goto('/Livegames');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
  }

  /**
   * Navigate to table games section
   */
  async gotoTableGames() {
    await this.page.goto('/lobby/casino-games/table-games');
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(2000);
  }

  /**
   * Search for a game by name - clicks on search area to open search modal
   */
  async searchGame(gameName: string): Promise<void> {
    // First, dismiss any cookie consent or overlay banners
    await this.dismissOverlays();

    // Try to click directly on the search input first (it has id="casino-search")
    const searchInput = this.page.locator('#casino-search, input[placeholder*="Search" i]').first();

    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Use force click in case there's an overlay
      await searchInput.click({ force: true });
      await searchInput.fill(gameName);

      // Click on search icon to trigger search
      await this.clickSearchIcon();
      await this.page.waitForTimeout(2000); // Wait for search results to load
      return;
    }

    // If search input not directly visible, try clicking the search label/trigger
    const searchTrigger = this.page.locator('label[for="casino-search"], [data-testid="search"], .search-trigger').first();
    if (await searchTrigger.isVisible().catch(() => false)) {
      await searchTrigger.click({ force: true });
      await this.page.waitForTimeout(1000);

      // Now try the input again
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await searchInput.click();
        await searchInput.fill(gameName);

        // Click on search icon to trigger search
        await this.clickSearchIcon();
        await this.page.waitForTimeout(2000);
        return;
      }
    }

    // Fallback: try getByRole
    const roleInput = this.page.getByRole('textbox', { name: 'Search' });
    if (await roleInput.isVisible().catch(() => false)) {
      await roleInput.fill(gameName);

      // Click on search icon to trigger search
      await this.clickSearchIcon();
      await this.page.waitForTimeout(2000);
      return;
    }

    console.warn('Search input not found');
  }

  /**
   * Click on the search icon/button to trigger search
   */
  async clickSearchIcon(): Promise<void> {
    // Common search icon/button selectors
    const searchIconSelectors = [
      'button[aria-label="Search"]',
      'button[type="submit"]',
      '[class*="search"] button',
      '[class*="search"] svg',
      '[class*="search-icon"]',
      'img[alt*="search" i]',
      'svg[class*="search"]',
      '#casino-search + button',
      '#casino-search ~ button',
      'input#casino-search + img',
      'input#casino-search ~ img',
    ];

    for (const selector of searchIconSelectors) {
      const searchIcon = this.page.locator(selector).first();
      if (await searchIcon.isVisible({ timeout: 500 }).catch(() => false)) {
        await searchIcon.click();
        await this.page.waitForTimeout(500);
        return;
      }
    }

    // Fallback: Press Enter key to trigger search
    await this.page.keyboard.press('Enter');
    await this.page.waitForTimeout(500);
  }

  /**
   * Dismiss any overlays like cookie consent banners and modal popups
   */
  async dismissOverlays(): Promise<void> {
    // Common cookie consent and overlay dismiss buttons
    const dismissButtons = [
      'button[aria-label="Got it"]',
      'button:has-text("Got it")',
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("OK")',
      'button:has-text("Close")',
      'button:has-text("No thanks")',
      'button:has-text("Maybe later")',
      'button:has-text("Skip")',
      '.cookie-banner button',
      '[class*="cookie"] button',
      '[class*="consent"] button',
      '[class*="modal"] button[aria-label="Close"]',
      '[class*="popup"] button[aria-label="Close"]',
      '[class*="overlay"] button[aria-label="Close"]',
      'div.fixed button:has-text("Close")',
      'div.fixed button:has-text("X")',
      'div.fixed svg[class*="close"]',
    ];

    for (const selector of dismissButtons) {
      const button = this.page.locator(selector).first();
      if (await button.isVisible({ timeout: 500 }).catch(() => false)) {
        await button.click().catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }

    // Try to close any fixed overlay by clicking outside or pressing Escape
    const fixedOverlay = this.page.locator('div.fixed.z-50').first();
    if (await fixedOverlay.isVisible({ timeout: 500 }).catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);
    }
  }

  /**
   * Get all visible game cards from the grid
   * Updated to match Betway's actual HTML structure
   */
  async getGameCards(): Promise<Locator> {
    // Wait for game grid to load - look for divs containing game images
    await this.page.waitForSelector('div.rounded-lg img[alt], div.overflow-hidden img[alt]', { timeout: 10000 })
      .catch(() => console.warn('Game cards not found'));

    // Return all game card containers (divs with rounded-lg that contain images)
    return this.page.locator('div.rounded-lg.overflow-hidden').filter({
      has: this.page.locator('img[alt]')
    });
  }

  /**
   * Get game card by name - searches by image alt text or card text content
   */
  async getGameByName(gameName: string): Promise<Locator | null> {
    // First try to find by exact image alt match
    const exactMatch = this.page.locator(`div.rounded-lg:has(img[alt="${gameName}"])`).first();
    if (await exactMatch.count() > 0) {
      return exactMatch;
    }

    // Try partial image alt match (case insensitive)
    const partialMatch = this.page.locator(`div.rounded-lg:has(img[alt*="${gameName}" i])`).first();
    if (await partialMatch.count() > 0) {
      return partialMatch;
    }

    // Fallback: search by text content in the card
    const cards = await this.getGameCards();
    const count = await cards.count();

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const text = await card.textContent();
      if (text?.toLowerCase().includes(gameName.toLowerCase())) {
        return card;
      }
    }

    return null;
  }

  /**
   * Click on a game card from the grid to play it
   * This handles the hover-to-reveal Play button pattern
   */
  async clickGameCard(gameName: string): Promise<void> {
    const gameCard = await this.getGameByName(gameName);

    if (!gameCard) {
      throw new Error(`Game card for "${gameName}" not found`);
    }

    // Method 1: Try to force click on the hidden Play link
    const playLink = gameCard.locator('a[href*="/lobby/casino-games/game/"]').first();
    if (await playLink.count() > 0) {
      await playLink.click({ force: true });
      return;
    }

    // Method 2: Hover to reveal Play button, then click
    await gameCard.hover();
    await this.page.waitForTimeout(500); // Wait for hover animation

    const playButton = gameCard.locator('button[aria-label="Play"], button:has-text("Play")').first();
    if (await playButton.isVisible({ timeout: 2000 }).catch(() => false)) {
      await playButton.click();
      return;
    }

    // Method 3: Click on the game image directly
    const gameImage = gameCard.locator('img[alt]').first();
    if (await gameImage.isVisible()) {
      await gameImage.click();
      return;
    }

    throw new Error(`Unable to click on game "${gameName}"`);
  }

  /**
   * Click on a game to open it
   * Updated to handle Betway's grid structure where Play button appears on hover
   * Also handles login popup that appears after clicking Play
   */
  async openGame(gameName: string, mode: 'play' | 'demo' = 'demo'): Promise<void> {
    // First search for the game (this opens the search modal)
    await this.searchGame(gameName);

    // Wait for search results to load
    await this.page.waitForTimeout(2000);

    let gameClicked = false;

    // Strategy 1: Find game card by image alt text and click the Play link directly
    // The Play button is hidden (opacity-0) but we can force click on the anchor
    const gameImage = this.page.locator(`img[alt*="${gameName}" i]`).first();

    if (await gameImage.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Find the game card container - parent div with rounded-lg class
      const gameCard = gameImage.locator('xpath=ancestor::div[contains(@class, "rounded-lg") and contains(@class, "overflow-hidden")]').first();

      // Get bounding box and use mouse to hover on the card
      const box = await gameCard.boundingBox({ timeout: 3000 }).catch(() => null);
      if (box) {
        // Move mouse to center of the card to trigger hover state
        await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await this.page.waitForTimeout(1000); // Wait for hover animation (opacity change)

        // Find the Play button inside the overlay (it becomes visible on hover)
        const playButton = gameCard.locator('button[aria-label="Play"]').first();
        if (await playButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Use JavaScript click to bypass Playwright's viewport checks
          await playButton.evaluate((el: HTMLElement) => el.click());
          gameClicked = true;
          console.log('Clicked Play button via JavaScript');
        } else {
          // Fallback: click the anchor link directly
          const playLink = gameCard.locator('a[href*="/lobby/casino-games/game/"]').first();
          if (await playLink.count() > 0) {
            await playLink.click({ force: true });
            gameClicked = true;
          }
        }
      }

      // Strategy 1b: Search modal cards - click the game image or its parent link directly
      if (!gameClicked) {
        console.log('Strategy 1b: Trying search modal click...');
        // In the search modal, the game card may be a direct link wrapping the image
        const parentLink = gameImage.locator('xpath=ancestor::a[contains(@href, "/game/")]').first();
        if (await parentLink.count().catch(() => 0) > 0) {
          await parentLink.click({ force: true });
          gameClicked = true;
          console.log('Clicked game link in search modal');
        } else {
          // Try clicking the image itself (some modals navigate on image click)
          await gameImage.click({ force: true });
          gameClicked = true;
          console.log('Clicked game image directly in search modal');
        }
      }
    }

    // Strategy 2: Find by partial match on first word of game name
    const words = gameName.split(' ');
    if (!gameClicked && words.length > 0) {
      const partialImage = this.page.locator(`img[alt*="${words[0]}" i]`).first();

      if (await partialImage.isVisible({ timeout: 3000 }).catch(() => false)) {
        const gameCard = partialImage.locator('xpath=ancestor::div[contains(@class, "rounded-lg")]').first();
        const playLink = gameCard.locator('a[href*="/lobby/casino-games/game/"]').first();

        if (await playLink.count() > 0) {
          await playLink.click({ force: true });
          gameClicked = true;
        }
      }
    }

    // Strategy 3: Find game by name text in the card footer
    if (!gameClicked) {
      const gameNameDiv = this.page.locator('div.text-ellipsis, div.font-bold').filter({ hasText: gameName }).first();

      if (await gameNameDiv.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Navigate up to find the game card container
        const gameCard = gameNameDiv.locator('xpath=ancestor::div[contains(@class, "rounded-lg")]').first();
        const playLink = gameCard.locator('a[href*="/lobby/casino-games/game/"]').first();

        if (await playLink.count() > 0) {
          await playLink.click({ force: true });
          gameClicked = true;
        } else {
          // Fallback: hover and click
          await gameCard.hover();
          await this.page.waitForTimeout(500);
          const playButton = gameCard.locator('button[aria-label="Play"]').first();
          if (await playButton.isVisible({ timeout: 2000 }).catch(() => false)) {
            await playButton.evaluate((el: HTMLElement) => el.click());
            gameClicked = true;
            console.log('Clicked Play button via fallback JavaScript');
          }
        }
      }
    }

    // Strategy 4: Find any link with game name slug in URL
    if (!gameClicked) {
      const gameSlug = gameName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
      const slugVariations = [
        gameSlug,
        words[0]?.toLowerCase(),
        gameName.toLowerCase().replace(/\s+/g, '-'),
      ].filter(Boolean);

      for (const slug of slugVariations) {
        const gameLink = this.page.locator(`a[href*="${slug}"][href*="/game/"]`).first();
        if (await gameLink.count() > 0) {
          await gameLink.click({ force: true });
          gameClicked = true;
          break;
        }
      }
    }

    // Strategy 5: Click directly on any visible game card image
    if (!gameClicked) {
      const anyGameImage = this.page.locator('img[alt]').filter({ hasText: new RegExp(words[0] || gameName, 'i') }).first();
      if (await anyGameImage.isVisible({ timeout: 2000 }).catch(() => false)) {
        await anyGameImage.click();
        gameClicked = true;
      }
    }

    if (!gameClicked) {
      throw new Error(`Game "${gameName}" not found on the page. Try searching manually or verify the game name.`);
    }

    // Wait for game to load
    await this.page.waitForLoadState('domcontentloaded');
    await this.page.waitForTimeout(3000);
  }

  /**
   * Get all game names from current page
   * Updated to read from the text-ellipsis div or image alt attributes
   */
  async getAllGameNames(): Promise<string[]> {
    const cards = await this.getGameCards();
    const count = await cards.count();
    const names: string[] = [];

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);

      // Try to get name from the footer text (div with text-ellipsis)
      const nameDiv = card.locator('div.text-ellipsis, div.font-bold.text-xs').first();
      let name = await nameDiv.textContent().catch(() => null);

      // Fallback: get from image alt attribute
      if (!name) {
        const img = card.locator('img[alt]').first();
        name = await img.getAttribute('alt').catch(() => null);
      }

      if (name) {
        names.push(name.trim());
      }
    }

    return names;
  }

  /**
   * Apply category filter
   */
  async filterByCategory(category: string): Promise<void> {
    const filter = this.categoryFilters.filter({ hasText: category }).first();
    if (await filter.isVisible()) {
      await filter.click();
      await this.page.waitForTimeout(1000);
    }
  }

  /**
   * Load more games (if pagination exists)
   */
  async loadMoreGames(): Promise<void> {
    if (await this.loadMoreButton.isVisible()) {
      await this.loadMoreButton.click();
      await this.page.waitForTimeout(2000);
    }
  }

  /**
   * Get total number of visible games
   */
  async getGameCount(): Promise<number> {
    return await this.gameCards.count();
  }

  /**
   * Check if a specific game exists
   */
  async hasGame(gameName: string): Promise<boolean> {
    const game = await this.getGameByName(gameName);
    return game !== null;
  }

  /**
   * Get game metadata from card
   */
  async getGameMetadata(gameCard: Locator): Promise<{
    name: string;
    provider?: string;
    hasDemo: boolean;
    thumbnailUrl?: string;
  }> {
    const name = await gameCard.locator('h3, h4, .game-title, .game-name').textContent() || '';
    const provider = await gameCard.locator('.provider, .game-provider').textContent() || undefined;
    const demoButton = gameCard.locator('button:has-text("Demo"), button:has-text("Try")');
    const hasDemo = await demoButton.count() > 0;
    
    let thumbnailUrl: string | undefined;
    const img = gameCard.locator('img').first();
    if (await img.count() > 0) {
      thumbnailUrl = await img.getAttribute('src') || undefined;
    }

    return {
      name: name.trim(),
      provider: provider?.trim(),
      hasDemo,
      thumbnailUrl
    };
  }

  /**
   * Scroll through all games (for discovery)
   */
  async scrollThroughAllGames(): Promise<string[]> {
    const allGames: string[] = [];
    let previousCount = 0;
    let currentCount = await this.getGameCount();

    while (currentCount > previousCount) {
      // Get current games
      const names = await this.getAllGameNames();
      allGames.push(...names.filter(n => !allGames.includes(n)));

      // Scroll down or load more
      await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await this.page.waitForTimeout(1000);

      // Try load more button
      if (await this.loadMoreButton.isVisible()) {
        await this.loadMoreButton.click();
        await this.page.waitForTimeout(2000);
      }

      previousCount = currentCount;
      currentCount = await this.getGameCount();

      // Safety break
      if (allGames.length > 500) break;
    }

    return allGames;
  }
}
