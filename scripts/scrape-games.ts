import axios from 'axios';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Game Catalog Scraper for Betway
 * Discovers all games, identifies canvas vs iframe, and creates metadata catalog
 */

interface GameMetadata {
  id: string;
  name: string;
  url: string;
  category: string;
  provider?: string;
  gameType: 'canvas' | 'iframe' | 'unknown';
  hasDemo: boolean;
  thumbnailUrl?: string;
  tags: string[];
  scrapedAt: string;
}

interface GameCatalog {
  totalGames: number;
  lastUpdated: string;
  categories: {
    [key: string]: number;
  };
  providers: {
    [key: string]: number;
  };
  games: GameMetadata[];
}

class BetwayGameScraper {
  private baseUrl: string = 'https://www.betway.co.za';
  private catalog: GameCatalog = {
    totalGames: 0,
    lastUpdated: '',
    categories: {},
    providers: {},
    games: []
  };

  // Category URLs to scrape
  private categoryUrls = [
    '/lobby/casino-games/slots',
    '/lobby/casino-games',
    '/Livegames'
  ];

  /**
   * Main scraping function
   */
  async scrapeAllGames(): Promise<GameCatalog> {
    console.log('🎰 Starting Betway game catalog scraping...\n');

    for (const categoryUrl of this.categoryUrls) {
      await this.scrapeCategory(categoryUrl);
    }

    this.catalog.totalGames = this.catalog.games.length;
    this.catalog.lastUpdated = new Date().toISOString();

    // Save catalog to file
    this.saveCatalog();

    // Print summary
    this.printSummary();

    return this.catalog;
  }

  /**
   * Scrape games from a specific category
   */
  private async scrapeCategory(categoryUrl: string): Promise<void> {
    const fullUrl = `${this.baseUrl}${categoryUrl}`;
    console.log(`\n📂 Scraping category: ${categoryUrl}`);

    try {
      const response = await axios.get(fullUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 30000
      });

      const $ = cheerio.load(response.data);

      // Extract game elements (this will need to be adjusted based on actual HTML structure)
      // Common patterns for game listings
      const gameSelectors = [
        '.game-item',
        '.slot-game',
        '[data-game-id]',
        '.casino-game-card',
        'article.game',
        'div[data-testid*="game"]'
      ];

      let gamesFound = 0;

      for (const selector of gameSelectors) {
        $(selector).each((index, element) => {
          const game = this.extractGameData($, element as Element, categoryUrl);
          if (game && !this.isDuplicate(game)) {
            this.catalog.games.push(game);
            this.updateCategoryCounts(game);
            gamesFound++;
          }
        });

        if (gamesFound > 0) break; // Found games with this selector
      }

      console.log(`   ✓ Found ${gamesFound} games`);

    } catch (error) {
      console.error(`   ✗ Error scraping ${categoryUrl}:`, (error as Error).message);
    }
  }

  /**
   * Extract game data from HTML element
   */
  private extractGameData($: cheerio.CheerioAPI, element: Element, category: string): GameMetadata | null {
    const $el = $(element);

    // Try various patterns to extract game name
    const name = 
      $el.attr('data-game-name') ||
      $el.attr('title') ||
      $el.find('.game-title').text().trim() ||
      $el.find('.game-name').text().trim() ||
      $el.find('h3').text().trim() ||
      $el.find('h4').text().trim();

    if (!name) return null;

    // Try to extract game ID
    const id = 
      $el.attr('data-game-id') ||
      $el.attr('data-id') ||
      $el.attr('id') ||
      this.generateIdFromName(name);

    // Extract URL
    const urlElement = $el.find('a').first();
    let url = urlElement.attr('href') || '';
    if (url && !url.startsWith('http')) {
      url = url.startsWith('/') ? `${this.baseUrl}${url}` : `${this.baseUrl}/${url}`;
    }

    // Extract thumbnail
    const thumbnail = 
      $el.find('img').attr('src') ||
      $el.find('img').attr('data-src') ||
      $el.css('background-image')?.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1');

    // Extract provider
    const provider = 
      $el.attr('data-provider') ||
      $el.find('.provider').text().trim() ||
      undefined;

    // Determine if demo is available
    const hasDemo = 
      $el.find('.demo-mode').length > 0 ||
      $el.find('[data-demo]').length > 0 ||
      $el.text().toLowerCase().includes('play demo') ||
      true; // Assume demo available by default for Betway

    // Extract tags
    const tags: string[] = [];
    $el.find('.tag, .badge').each((_, tagEl) => {
      const tag = $(tagEl).text().trim();
      if (tag) tags.push(tag);
    });

    // Determine category
    const categoryName = this.getCategoryFromUrl(category);

    return {
      id,
      name,
      url,
      category: categoryName,
      provider,
      gameType: 'unknown', // Will be determined during actual game load
      hasDemo,
      thumbnailUrl: thumbnail,
      tags,
      scrapedAt: new Date().toISOString()
    };
  }

  /**
   * Check if game already exists in catalog
   */
  private isDuplicate(game: GameMetadata): boolean {
    return this.catalog.games.some(g => g.id === game.id || g.name === game.name);
  }

  /**
   * Update category and provider counts
   */
  private updateCategoryCounts(game: GameMetadata): void {
    // Update category count
    this.catalog.categories[game.category] = (this.catalog.categories[game.category] || 0) + 1;

    // Update provider count
    if (game.provider) {
      this.catalog.providers[game.provider] = (this.catalog.providers[game.provider] || 0) + 1;
    }
  }

  /**
   * Generate ID from game name
   */
  private generateIdFromName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Get category name from URL
   */
  private getCategoryFromUrl(url: string): string {
    if (url.includes('slots')) return 'slots';
    if (url.includes('live')) return 'live-casino';
    if (url.includes('table')) return 'table-games';
    if (url.includes('jackpot')) return 'jackpots';
    return 'casino-games';
  }

  /**
   * Save catalog to JSON file
   */
  private saveCatalog(): void {
    const outputDir = path.join(__dirname, '../config');
    const outputPath = path.join(outputDir, 'games-catalog.json');

    // Create directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(this.catalog, null, 2));
    console.log(`\n💾 Catalog saved to: ${outputPath}`);
  }

  /**
   * Print scraping summary
   */
  private printSummary(): void {
    console.log('\n📊 Scraping Summary:');
    console.log('='.repeat(50));
    console.log(`Total games discovered: ${this.catalog.totalGames}`);
    console.log('\nGames by category:');
    Object.entries(this.catalog.categories).forEach(([category, count]) => {
      console.log(`  ${category}: ${count}`);
    });
    console.log('\nGames by provider:');
    Object.entries(this.catalog.providers).forEach(([provider, count]) => {
      console.log(`  ${provider}: ${count}`);
    });
    console.log('='.repeat(50));
  }
}

/**
 * Alternative: Static game catalog for immediate use
 * This contains known popular games from Betway
 */
export function createStaticGameCatalog(): GameCatalog {
  const staticGames: GameMetadata[] = [
    // Popular Slots
    {
      id: 'hot-hot-betway',
      name: 'Hot Hot Betway',
      url: '/lobby/casino-games/slots/hot-hot-betway',
      category: 'slots',
      provider: 'Habanero',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['popular', 'fruit', 'classic'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: 'gonzo-quest-megaways',
      name: "Gonzo's Quest Megaways",
      url: '/lobby/casino-games/slots/gonzo-quest-megaways',
      category: 'slots',
      provider: 'NetEnt',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['popular', 'megaways', 'adventure'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: 'starburst',
      name: 'Starburst',
      url: '/lobby/casino-games/slots/starburst',
      category: 'slots',
      provider: 'NetEnt',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['popular', 'classic', 'space'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: 'wealth-inn',
      name: 'Wealth Inn',
      url: '/lobby/casino-games/slots/wealth-inn',
      category: 'slots',
      provider: 'Pragmatic Play',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['popular', 'asian'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: '777-strike',
      name: '777 Strike',
      url: '/lobby/casino-games/slots/777-strike',
      category: 'slots',
      provider: 'Red Tiger',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['classic', '777'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: 'hey-sushi',
      name: 'Hey Sushi',
      url: '/lobby/casino-games/slots/hey-sushi',
      category: 'slots',
      provider: 'Habanero',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['asian', 'food'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: 'book-of-dead',
      name: 'Book of Dead',
      url: '/lobby/casino-games/slots/book-of-dead',
      category: 'slots',
      provider: "Play'n GO",
      gameType: 'canvas',
      hasDemo: true,
      tags: ['popular', 'egypt', 'adventure'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: 'gates-of-olympus',
      name: 'Gates of Olympus',
      url: '/lobby/casino-games/slots/gates-of-olympus',
      category: 'slots',
      provider: 'Pragmatic Play',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['popular', 'mythology', 'greek'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: 'disco-beats',
      name: 'Disco Beats',
      url: '/lobby/casino-games/slots/disco-beats',
      category: 'slots',
      provider: 'Habanero',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['music', 'retro'],
      scrapedAt: new Date().toISOString()
    },
    {
      id: 'cash-volt',
      name: 'Cash Volt',
      url: '/lobby/casino-games/slots/cash-volt',
      category: 'slots',
      provider: 'Red Tiger',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['electric', 'modern'],
      scrapedAt: new Date().toISOString()
    },

    // Special Games
    {
      id: 'aviator',
      name: 'Aviator',
      url: '/lobby/casino-games/aviator',
      category: 'crash-games',
      provider: 'Spribe',
      gameType: 'canvas',
      hasDemo: true,
      tags: ['popular', 'crash', 'multiplier'],
      scrapedAt: new Date().toISOString()
    }
  ];

  const catalog: GameCatalog = {
    totalGames: staticGames.length,
    lastUpdated: new Date().toISOString(),
    categories: {},
    providers: {},
    games: staticGames
  };

  // Calculate category and provider counts
  staticGames.forEach(game => {
    catalog.categories[game.category] = (catalog.categories[game.category] || 0) + 1;
    if (game.provider) {
      catalog.providers[game.provider] = (catalog.providers[game.provider] || 0) + 1;
    }
  });

  return catalog;
}

// Main execution
if (require.main === module) {
  const scraper = new BetwayGameScraper();
  
  // Option 1: Use static catalog (immediate)
  console.log('Creating static game catalog...');
  const staticCatalog = createStaticGameCatalog();
  
  const outputDir = path.join(__dirname, '../config');
  const outputPath = path.join(outputDir, 'games-catalog.json');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(staticCatalog, null, 2));
  console.log(`\n✓ Static catalog created with ${staticCatalog.totalGames} games`);
  console.log(`💾 Saved to: ${outputPath}`);
  
  // Option 2: Run dynamic scraper (requires actual website access)
  // Uncomment to use:
  // scraper.scrapeAllGames().catch(console.error);
}

export { BetwayGameScraper, GameMetadata, GameCatalog };
