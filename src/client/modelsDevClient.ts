import { ModelsDevResponse } from './types';

const MODELS_DEV_URL = 'https://models.dev/api.json';

export class ModelsDevClient {
  async fetchCatalog(signal?: AbortSignal): Promise<ModelsDevResponse> {
    const response = await fetch(MODELS_DEV_URL, {
      signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models.dev catalog: HTTP ${response.status}`);
    }

    return response.json() as Promise<ModelsDevResponse>;
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.fetchCatalog();
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
