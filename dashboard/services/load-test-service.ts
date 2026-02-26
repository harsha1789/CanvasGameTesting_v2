/**
 * Load Test Service — Wraps HarLoadTester with SSE progress events.
 */

import { HarLoadTester, LoadTestResult, LoadTestConfig } from '../../utils/har-load-tester';
import { progressEmitter } from '../routes/sse-routes';

const DEFAULT_CONFIG: LoadTestConfig = {
  virtualUsers: 5,
  iterations: 2,
  rampUpSeconds: 5,
  thinkTimeMs: 500,
  timeoutMs: 30000,
  includeStaticAssets: false,
};

export class LoadTestService {
  private tester = new HarLoadTester();

  async runForGame(
    gameName: string,
    gameId: string,
    harFilePath: string,
    config: Partial<LoadTestConfig> = {}
  ): Promise<LoadTestResult> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    progressEmitter.emit('progress', {
      type: 'loadtest:game-start',
      payload: { gameId, gameName },
    });
    progressEmitter.emit('progress', {
      type: 'log',
      payload: { message: `[Load Test] Starting ${gameName} with ${fullConfig.virtualUsers} VUs x ${fullConfig.iterations} iterations`, level: 'info', timestamp: Date.now() },
    });

    const result = await this.tester.runLoadTest(gameName, gameId, harFilePath, fullConfig);

    progressEmitter.emit('progress', {
      type: 'loadtest:game-complete',
      payload: { gameId, totalRequests: result.totalRequests, errorRate: result.errorRate, avgResponseTimeMs: result.avgResponseTimeMs },
    });
    progressEmitter.emit('progress', {
      type: 'log',
      payload: { message: `[Load Test] ${gameName} complete: ${result.totalRequests} requests, ${result.errorRate.toFixed(1)}% error rate`, level: 'info', timestamp: Date.now() },
    });

    return result;
  }

  async runForAllGames(
    games: Array<{ gameName: string; gameId: string; harFilePath: string }>,
    config: Partial<LoadTestConfig> = {},
    sessionId: string
  ): Promise<LoadTestResult[]> {
    const results: LoadTestResult[] = [];

    progressEmitter.emit('progress', {
      type: 'loadtest:start',
      payload: { sessionId, totalGames: games.length },
    });

    for (const game of games) {
      const result = await this.runForGame(game.gameName, game.gameId, game.harFilePath, config);
      results.push(result);
    }

    progressEmitter.emit('progress', {
      type: 'loadtest:complete',
      payload: { sessionId, totalGames: games.length, totalRequests: results.reduce((s, r) => s + r.totalRequests, 0) },
    });

    return results;
  }
}
