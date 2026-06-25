import { EventEmitter } from 'vscode';
import { request as httpsRequest, RequestOptions } from 'https';
import { OpenCodeAuthService } from './openCodeAuthService';

/**
 * Usage data from OpenCode API.
 */
export interface UsageData {
  workspaceId: string;
  period: string;
  totalCost: number;
  totalTokens: number;
  models: ModelUsage[];
  dailyUsage: DailyUsage[];
  lastUpdated: Date;
  goLimits?: GoLimits;
}

export interface ModelUsage {
  modelId: string;
  modelName: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface DailyUsage {
  date: string;
  requests: number;
  tokens: number;
  cost: number;
}

export interface GoLimits {
  rolling: { percent: number; resetsAt: string };
  weekly: { percent: number; resetsAt: string };
  monthly: { percent: number; resetsAt: string };
}

/**
 * Service for fetching OpenCode usage data in background.
 * Uses the _server endpoint with auth cookie for authentication.
 */
export class OpenCodeUsageService {
  private static instance: OpenCodeUsageService;
  private readonly authService: OpenCodeAuthService;
  private usageData: UsageData | null = null;
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private readonly _onDidChangeUsage = new EventEmitter<UsageData>();
  readonly onDidChangeUsage = this._onDidChangeUsage.event;

  private constructor() {
    this.authService = OpenCodeAuthService.getInstance();
  }

  public static getInstance(): OpenCodeUsageService {
    if (!OpenCodeUsageService.instance) {
      OpenCodeUsageService.instance = new OpenCodeUsageService();
    }
    return OpenCodeUsageService.instance;
  }

  /**
   * Start periodic refresh of usage data.
   */
  startAutoRefresh(intervalMs: number = 5 * 60 * 1000): void {
    this.stopAutoRefresh();
    
    // Initial fetch
    void this.fetchUsageData();
    
    // Periodic refresh
    this.refreshInterval = setInterval(() => {
      void this.fetchUsageData();
    }, intervalMs);
  }

  /**
   * Stop periodic refresh.
   */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Fetch usage data from OpenCode API.
   * Automatically discovers workspace ID and uses API key for auth.
   */
  async fetchUsageData(): Promise<UsageData | null> {
    // Try to get workspace ID from storage first
    let workspaceId = await this.authService.getWorkspaceId();
    
    // If not stored, try to discover from the page
    if (!workspaceId) {
      const goKey = await this.authService.getGoKey();
      const zenKey = await this.authService.getZenKey();
      const apiKey = goKey || zenKey;
      
      if (apiKey) {
        workspaceId = await this.discoverWorkspaceId(apiKey);
        if (workspaceId) {
          await this.authService.setWorkspaceId(workspaceId);
        }
      }
    }

    if (!workspaceId) {
      console.log('[OpenCode Usage] No workspace ID available');
      return null;
    }

    // Get the API key for authentication
    const goKey = await this.authService.getGoKey();
    const zenKey = await this.authService.getZenKey();
    const apiKey = goKey || zenKey;

    if (!apiKey) {
      console.log('[OpenCode Usage] No API key available');
      return null;
    }

    try {
      const data = await this.fetchUsage(workspaceId, apiKey);
      if (data) {
        this.usageData = data;
        this._onDidChangeUsage.fire(data);
      }
      return data;
    } catch (error) {
      console.error('[OpenCode Usage] Failed to fetch usage data:', error);
      return null;
    }
  }

  /**
   * Discover workspace ID by fetching the user's workspace page.
   */
  private async discoverWorkspaceId(apiKey: string): Promise<string | null> {
    return new Promise((resolve) => {
      const options: RequestOptions = {
        hostname: 'opencode.ai',
        path: '/workspace',
        method: 'GET',
        headers: {
          'accept': 'text/html',
          'Authorization': `Bearer ${apiKey}`,
        },
      };

      const req = httpsRequest(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          // Extract workspace ID from /workspace/{id} pattern
          const match = data.match(/\/workspace\/(wrk_[a-zA-Z0-9]+)/);
          if (match) {
            console.log(`[OpenCode Usage] Discovered workspace ID: ${match[1]}`);
            resolve(match[1]);
          } else {
            console.log('[OpenCode Usage] Could not find workspace ID in page');
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Fetch usage from the _server endpoint.
   * Uses API key for authentication and discovers server ID dynamically.
   */
  private async fetchUsage(workspaceId: string, apiKey: string): Promise<UsageData> {
    // Step 1: Discover the current server ID from the page
    const serverId = await this.discoverServerId(workspaceId, apiKey);
    if (!serverId) {
      throw new Error('Could not discover OpenCode server ID from page');
    }

    // Step 2: Make the API call
    const args = JSON.stringify({
      t: { t: 9, i: 0, l: 2, a: [{ t: 1, s: workspaceId }, { t: 0, s: 0 }] },
      f: 31,
      m: [],
    });

    const encodedArgs = encodeURIComponent(args);
    const url = `/_server?id=${serverId}&args=${encodedArgs}`;

    return new Promise((resolve, reject) => {
      const options: RequestOptions = {
        hostname: 'opencode.ai',
        path: url,
        method: 'GET',
        headers: {
          'accept': '*/*',
          'x-server-id': serverId,
          'x-server-instance': 'server-fn:5',
          'Authorization': `Bearer ${apiKey}`,
          'Referer': `https://opencode.ai/workspace/${workspaceId}/usage`,
          'sec-fetch-dest': 'empty',
          'sec-fetch-mode': 'cors',
          'sec-fetch-site': 'same-origin',
        },
      };

      const req = httpsRequest(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(this.parseUsageResponse(workspaceId, parsed));
          } catch (e) {
            reject(new Error(`Failed to parse usage data: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      req.end();
    });
  }

  /**
   * Discover the server ID by fetching the workspace page HTML
   * and extracting it from the _server?id= pattern.
   */
  private async discoverServerId(workspaceId: string, apiKey: string): Promise<string | null> {
    return new Promise((resolve) => {
      const options: RequestOptions = {
        hostname: 'opencode.ai',
        path: `/workspace/${workspaceId}/go`,
        method: 'GET',
        headers: {
          'accept': 'text/html',
          'Authorization': `Bearer ${apiKey}`,
        },
      };

      const req = httpsRequest(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          // Extract server ID from _server?id= pattern in the HTML
          const match = data.match(/_server\?id=([a-f0-9]{64})/);
          if (match) {
            console.log(`[OpenCode Usage] Discovered server ID: ${match[1]}`);
            resolve(match[1]);
          } else {
            console.log('[OpenCode Usage] Could not find server ID in page');
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.setTimeout(10000, () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }

  /**
   * Parse the API response into our UsageData format.
   */
  private parseUsageResponse(workspaceId: string, data: any): UsageData {
    // The _server endpoint returns a nested structure
    const usage = data?.p ?? data;
    
    return {
      workspaceId,
      period: usage?.period || 'current',
      totalCost: usage?.totalCost ?? usage?.cost?.total ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      models: (usage?.models ?? usage?.modelUsage ?? []).map((m: any) => ({
        modelId: m.id ?? m.modelId ?? m.model ?? '',
        modelName: m.name ?? m.modelName ?? m.model ?? m.id ?? '',
        requests: m.requests ?? m.count ?? 0,
        inputTokens: m.inputTokens ?? m.input ?? 0,
        outputTokens: m.outputTokens ?? m.output ?? 0,
        cost: m.cost ?? m.totalCost ?? 0,
      })),
      dailyUsage: (usage?.daily ?? usage?.dailyUsage ?? []).map((d: any) => ({
        date: d.date ?? d.day ?? '',
        requests: d.requests ?? d.count ?? 0,
        tokens: d.tokens ?? d.totalTokens ?? 0,
        cost: d.cost ?? d.totalCost ?? 0,
      })),
      lastUpdated: new Date(),
    };
  }

  /**
   * Get cached usage data.
   */
  getUsageData(): UsageData | null {
    return this.usageData;
  }

  /**
   * Generate mock data for demo/testing.
   */
  generateMockData(): UsageData {
    const models: ModelUsage[] = [
      { modelId: 'mimo-v2.5', modelName: 'MiMo V2.5', requests: 234, inputTokens: 12000000, outputTokens: 3400000, cost: 0.52 },
      { modelId: 'minimax-m2.7', modelName: 'MiniMax M2.7', requests: 12, inputTokens: 1500000, outputTokens: 180000, cost: 0.67 },
    ];

    const dailyUsage: DailyUsage[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      dailyUsage.push({
        date: date.toISOString().split('T')[0],
        requests: Math.floor(Math.random() * 50) + 10,
        tokens: Math.floor(Math.random() * 5000000) + 1000000,
        cost: Math.random() * 2 + 0.1,
      });
    }

    return {
      workspaceId: 'wrk_demo',
      period: 'current',
      totalCost: models.reduce((sum, m) => sum + m.cost, 0),
      totalTokens: models.reduce((sum, m) => sum + m.inputTokens + m.outputTokens, 0),
      models,
      dailyUsage,
      lastUpdated: new Date(),
      goLimits: {
        rolling: { percent: 0, resetsAt: '4h 49min' },
        weekly: { percent: 49, resetsAt: '2 days 5h' },
        monthly: { percent: 74, resetsAt: '11 days 21h' },
      },
    };
  }

  dispose(): void {
    this.stopAutoRefresh();
    this._onDidChangeUsage.dispose();
  }
}
