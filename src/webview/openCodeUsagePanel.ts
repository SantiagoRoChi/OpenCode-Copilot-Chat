import * as vscode from 'vscode';
import * as http from 'http';
import { OpenCodeAuthService } from '../integration/openCodeAuthService';

/**
 * Manages OpenCode login via VS Code's built-in Simple Browser.
 * Captures workspace ID and auth cookie automatically via a local HTTP server.
 */
export class OpenCodeUsagePanel {
  private static readonly AUTH_URL = 'https://opencode.ai/auth';
  private static readonly AUTH_CALLBACK_SCHEME = 'opencodezen';
  private static instance: OpenCodeUsagePanel | undefined;
  private authService: OpenCodeAuthService;
  private localServer: http.Server | null = null;
  private localPort: number = 0;
  private disposables: vscode.Disposable[] = [];

  private constructor(context: vscode.ExtensionContext) {
    this.authService = OpenCodeAuthService.getInstance();

    // Register URI handler to capture OAuth callback
    context.subscriptions.push(
      vscode.window.registerUriHandler({
        handleUri: (uri: vscode.Uri) => {
          this.handleUriCallback(uri);
        }
      })
    );
  }

  /**
   * Initialize the panel (call once during activation).
   */
  public static initialize(context: vscode.ExtensionContext): OpenCodeUsagePanel {
    if (!OpenCodeUsagePanel.instance) {
      OpenCodeUsagePanel.instance = new OpenCodeUsagePanel(context);
    }
    return OpenCodeUsagePanel.instance;
  }

  /**
   * Open the OpenCode login page in VS Code's Simple Browser.
   * Starts a local HTTP server to capture the OAuth callback.
   */
  public async openLogin(): Promise<void> {
    // Start local server to capture callback
    await this.startLocalServer();

    // Build the auth URL with our local server as redirect
    const redirectUri = `http://localhost:${this.localPort}/callback`;
    const authUrl = `${OpenCodeUsagePanel.AUTH_URL}?redirect_uri=${encodeURIComponent(redirectUri)}`;

    // Open in VS Code's Simple Browser (real browser, no CORS issues)
    await vscode.commands.executeCommand(
      'simpleBrowser.api.open',
      vscode.Uri.parse(authUrl),
      { viewColumn: vscode.ViewColumn.Beside }
    );

    vscode.window.showInformationMessage(
      'Log in to OpenCode in the browser panel. The workspace ID and auth cookie will be captured automatically.'
    );
  }

  /**
   * Start a local HTTP server to capture OAuth callbacks.
   */
  private async startLocalServer(): Promise<void> {
    if (this.localServer) {
      this.stopLocalServer();
    }

    return new Promise((resolve) => {
      this.localServer = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost`);
        
        if (url.pathname === '/callback') {
          // Capture workspace ID from query params or cookies
          const workspaceId = url.searchParams.get('workspace_id') || 
                              url.searchParams.get('workspace') ||
                              url.searchParams.get('wrk');
          
          // Capture auth cookie from request headers
          const cookieHeader = req.headers.cookie || '';
          const authMatch = cookieHeader.match(/auth=([^;]+)/);
          const authCookie = authMatch ? authMatch[1] : '';

          // Extract workspace ID from the redirect URL if present
          const redirectUrl = url.searchParams.get('redirect_uri') || url.searchParams.get('state') || '';
          const wrkMatch = redirectUrl.match(/\/workspace\/(wrk_[a-zA-Z0-9]+)/);
          const finalWorkspaceId = workspaceId || (wrkMatch ? wrkMatch[1] : null);

          if (finalWorkspaceId) {
            this.authService.setWorkspaceId(finalWorkspaceId);
            console.log(`[OpenCode] Captured workspace ID: ${finalWorkspaceId}`);
          }

          if (authCookie) {
            this.authService.setAuthCookie(authCookie);
            console.log(`[OpenCode] Captured auth cookie`);
          }

          // Send response to close the browser tab
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ OpenCode Login Successful</h1>
              <p>You can close this tab and return to VS Code.</p>
              <p style="color: #666;">Workspace: ${finalWorkspaceId || 'Unknown'}</p>
              <script>setTimeout(() => window.close(), 2000);</script>
            </body>
            </html>
          `);

          // Notify VS Code
          vscode.window.showInformationMessage(
            `✅ OpenCode authenticated! Workspace: ${finalWorkspaceId || 'Unknown'}`,
            'Open Usage'
          ).then(choice => {
            if (choice === 'Open Usage') {
              this.openWorkspaceUsage();
            }
          });
        } else {
          // For any other path, redirect to OpenCode
          res.writeHead(302, { 'Location': 'https://opencode.ai' });
          res.end();
        }
      });

      this.localServer.listen(0, '127.0.0.1', () => {
        const addr = this.localServer!.address();
        if (addr && typeof addr === 'object') {
          this.localPort = addr.port;
          console.log(`[OpenCode] Local callback server started on port ${this.localPort}`);
        }
        resolve();
      });
    });
  }

  /**
   * Stop the local HTTP server.
   */
  private stopLocalServer(): void {
    if (this.localServer) {
      this.localServer.close();
      this.localServer = null;
    }
  }

  /**
   * Open the workspace usage page directly (if we have the workspace ID).
   */
  public async openWorkspaceUsage(): Promise<void> {
    const workspaceId = await this.authService.getWorkspaceId();
    if (workspaceId) {
      const usageUrl = `https://opencode.ai/workspace/${workspaceId}/usage`;
      await vscode.commands.executeCommand(
        'simpleBrowser.api.open',
        vscode.Uri.parse(usageUrl),
        { viewColumn: vscode.ViewColumn.Beside }
      );
    } else {
      vscode.window.showWarningMessage(
        'No workspace configured. Please log in first.',
        'Login'
      ).then(choice => {
        if (choice === 'Login') {
          this.openLogin();
        }
      });
    }
  }

  /**
   * Prompt the user to paste the workspace URL after login.
   * This extracts the workspace ID from the URL.
   */
  public async promptForWorkspaceUrl(): Promise<void> {
    if (!this.authService) {
      vscode.window.showErrorMessage('OpenCode Auth Service not initialized. Please reload VS Code.');
      return;
    }

    const url = await vscode.window.showInputBox({
      title: 'OpenCode Workspace URL',
      prompt: 'Paste the URL from the browser after logging in (e.g., https://opencode.ai/workspace/wrk_xxx/usage)',
      placeHolder: 'https://opencode.ai/workspace/wrk_...',
      validateInput: (value) => {
        if (!value) return 'URL is required';
        const workspaceId = this.authService.extractWorkspaceId(value);
        if (!workspaceId) return 'URL must contain /workspace/{id}';
        return undefined;
      },
      ignoreFocusOut: true,
    });

    if (url) {
      await this.handleUrlPasted(url);
    }
  }

  /**
   * Handle a URL pasted by the user.
   * Extracts workspace ID automatically.
   */
  private async handleUrlPasted(url: string): Promise<void> {
    const workspaceId = this.authService.extractWorkspaceId(url);
    if (workspaceId) {
      await this.authService.setWorkspaceId(workspaceId);
      
      vscode.window.showInformationMessage(
        `✅ Workspace configured: ${workspaceId}`,
        'Open Usage'
      ).then(choice => {
        if (choice === 'Open Usage') {
          this.openWorkspaceUsage();
        }
      });
    }
  }

  /**
   * Handle URI callback from OAuth redirect.
   */
  private async handleUriCallback(uri: vscode.Uri): Promise<void> {
    const query = new URLSearchParams(uri.query);
    const code = query.get('code');
    const state = query.get('state');

    if (code) {
      // Store the auth code — in a real implementation, exchange for tokens
      await this.authService.setToken(code);
      vscode.window.showInformationMessage('OpenCode authentication code received!');
    }

    // Extract workspace ID from the path
    const pathParts = uri.path.split('/');
    const workspaceIndex = pathParts.indexOf('workspace');
    if (workspaceIndex >= 0 && workspaceIndex + 1 < pathParts.length) {
      const workspaceId = pathParts[workspaceIndex + 1];
      await this.authService.setWorkspaceId(workspaceId);
      vscode.window.showInformationMessage(`Workspace: ${workspaceId}`);
    }
  }

  /**
   * Extract workspace ID from a URL (e.g., from browser address bar).
   */
  public extractWorkspaceIdFromUrl(url: string): string | null {
    return this.authService.extractWorkspaceId(url);
  }

  dispose(): void {
    this.stopLocalServer();
    this.disposables.forEach(d => d.dispose());
  }
}
