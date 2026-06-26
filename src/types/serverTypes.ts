export interface ServerData {
  id: string;
  name: string;
  url: string;
  port?: number;
  version?: string;
  available: boolean;
  models: string[];
  providerCount: number;
  type?: 'opencode' | 'lmstudio' | 'ollama-plus';
}
