import * as vscode from 'vscode';
import { SecretStorage } from '../config/secretStorage';

/**
 * Service for managing OpenCode authentication.
 * Handles token storage, workspace ID, and API access.
 */
export class OpenCodeAuthService {
  private static instance: OpenCodeAuthService | undefined;
  private static pendingContext: vscode.ExtensionContext | undefined;
  private storage: SecretStorage | undefined;
  
  // SecretStorage keys
  private static readonly TOKEN_KEY = 'opencode-zen.openCodeToken';
  private static readonly REFRESH_TOKEN_KEY = 'opencode-zen.openCodeRefreshToken';
  private static readonly WORKSPACE_ID_KEY = 'opencode-zen.openCodeWorkspaceId';
  private static readonly EXPIRES_AT_KEY = 'opencode-zen.openCodeTokenExpiresAt';
  private static readonly AUTH_COOKIE_KEY = 'opencode-zen.openCodeAuthCookie';

  private constructor(context: vscode.ExtensionContext) {
    this.storage = new SecretStorage(context);
  }

  /**
   * Initialize the singleton with a context. Call this during activation.
   */
  public static init(context: vscode.ExtensionContext): OpenCodeAuthService {
    if (!OpenCodeAuthService.instance) {
      OpenCodeAuthService.instance = new OpenCodeAuthService(context);
    }
    return OpenCodeAuthService.instance;
  }

  /**
   * Get singleton instance of OpenCodeAuthService.
   * Returns undefined only if never initialized.
   */
  public static getInstance(): OpenCodeAuthService {
    if (!OpenCodeAuthService.instance) {
      // Should not happen if init() was called during activation
      console.warn('[OpenCodeAuthService] getInstance() called before init()');
      // Create a throwaway instance to avoid crashes
      OpenCodeAuthService.instance = new OpenCodeAuthService(OpenCodeAuthService.pendingContext!);
    }
    return OpenCodeAuthService.instance;
  }

  // ── API Key Management ────────────────────────────────────────────────────

  /**
   * Get the stored Go API key.
   */
  public async getGoKey(): Promise<string | null> {
    return this.storage?.getGoKey() ?? null;
  }

  /**
   * Get the stored Zen API key.
   */
  public async getZenKey(): Promise<string | null> {
    return this.storage?.getZenKey() ?? null;
  }

  // ── Token Management ─────────────────────────────────────────────────────

  /**
   * Store the access token.
   */
  public async setToken(token: string): Promise<void> {
    await this.storage?.setSecret(OpenCodeAuthService.TOKEN_KEY, token);
  }

  /**
   * Get the stored access token.
   */
  public async getToken(): Promise<string | null> {
    return this.storage?.getSecret(OpenCodeAuthService.TOKEN_KEY) ?? null;
  }

  /**
   * Store the refresh token.
   */
  public async setRefreshToken(token: string): Promise<void> {
    await this.storage?.setSecret(OpenCodeAuthService.REFRESH_TOKEN_KEY, token);
  }

  /**
   * Get the stored refresh token.
   */
  public async getRefreshToken(): Promise<string | null> {
    return this.storage?.getSecret(OpenCodeAuthService.REFRESH_TOKEN_KEY) ?? null;
  }

  /**
   * Store token expiration time.
   */
  public async setExpiresAt(expiresAt: number): Promise<void> {
    await this.storage?.setSecret(OpenCodeAuthService.EXPIRES_AT_KEY, String(expiresAt));
  }

  /**
   * Check if the token is expired.
   */
  public async isTokenExpired(): Promise<boolean> {
    const expiresAt = await this.storage?.getSecret(OpenCodeAuthService.EXPIRES_AT_KEY);
    if (!expiresAt) return true;
    return Date.now() > parseInt(expiresAt, 10);
  }

  // ── Workspace Management ─────────────────────────────────────────────────

  /**
   * Store the workspace ID.
   */
  public async setWorkspaceId(workspaceId: string): Promise<void> {
    await this.storage?.setSecret(OpenCodeAuthService.WORKSPACE_ID_KEY, workspaceId);
  }

  /**
   * Get the stored workspace ID.
   */
  public async getWorkspaceId(): Promise<string | null> {
    return this.storage?.getSecret(OpenCodeAuthService.WORKSPACE_ID_KEY) ?? null;
  }

  // ── Auth Cookie Management ────────────────────────────────────────────────

  /**
   * Store the auth cookie from OpenCode web session.
   */
  public async setAuthCookie(cookie: string): Promise<void> {
    await this.storage?.setSecret(OpenCodeAuthService.AUTH_COOKIE_KEY, cookie);
  }

  /**
   * Get the stored auth cookie.
   */
  public async getAuthCookie(): Promise<string | null> {
    return this.storage?.getSecret(OpenCodeAuthService.AUTH_COOKIE_KEY) ?? null;
  }

  // ── Authentication State ─────────────────────────────────────────────────

  /**
   * Check if the user is authenticated.
   */
  public async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    if (!token) return false;
    
    const isExpired = await this.isTokenExpired();
    if (isExpired) {
      // Try to refresh the token
      const refreshed = await this.refreshToken();
      return refreshed;
    }
    
    return true;
  }

  /**
   * Get the current workspace URL for usage.
   */
  public async getUsageUrl(): Promise<string> {
    const workspaceId = await this.getWorkspaceId();
    if (workspaceId) {
      return `https://opencode.ai/workspace/${workspaceId}/usage`;
    }
    return 'https://opencode.ai/auth';
  }

  /**
   * Extract workspace ID from a URL.
   */
  public extractWorkspaceId(url: string): string | null {
    const match = url.match(/\/workspace\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Handle the OAuth callback URL.
   * Extracts tokens and workspace ID from the URL.
   */
  public async handleCallback(url: string): Promise<boolean> {
    try {
      const parsedUrl = new URL(url);
      
      // Extract code from query params (OAuth flow)
      const code = parsedUrl.searchParams.get('code');
      if (code) {
        // TODO: Exchange code for tokens via OpenCode API
        // For now, just store the code
        await this.setToken(code);
      }

      // Extract workspace ID from path
      const workspaceId = this.extractWorkspaceId(url);
      if (workspaceId) {
        await this.setWorkspaceId(workspaceId);
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to handle callback:', error);
      return false;
    }
  }

  // ── Token Refresh ────────────────────────────────────────────────────────

  /**
   * Refresh the access token using the refresh token.
   */
  private async refreshToken(): Promise<boolean> {
    const refreshToken = await this.getRefreshToken();
    if (!refreshToken) return false;

    try {
      // TODO: Implement actual token refresh via OpenCode API
      // For now, return false
      return false;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return false;
    }
  }

  // ── Clear Data ───────────────────────────────────────────────────────────

  /**
   * Clear all stored authentication data.
   */
  public async clearAll(): Promise<void> {
    await this.storage?.deleteSecret(OpenCodeAuthService.TOKEN_KEY);
    await this.storage?.deleteSecret(OpenCodeAuthService.REFRESH_TOKEN_KEY);
    await this.storage?.deleteSecret(OpenCodeAuthService.WORKSPACE_ID_KEY);
    await this.storage?.deleteSecret(OpenCodeAuthService.EXPIRES_AT_KEY);
    await this.storage?.deleteSecret(OpenCodeAuthService.AUTH_COOKIE_KEY);
  }

  /**
   * Dispose of resources.
   */
  public dispose(): void {
    // Cleanup if needed
  }
}

/**
 * Extension of SecretStorage with additional methods for our use case.
 */
declare module '../config/secretStorage' {
  interface SecretStorage {
    setSecret(key: string, value: string): Promise<void>;
    getSecret(key: string): Promise<string | null>;
    deleteSecret(key: string): Promise<void>;
  }
}
