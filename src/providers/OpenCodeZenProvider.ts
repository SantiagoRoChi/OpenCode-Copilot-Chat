import * as vscode from 'vscode';
import { BaseOpenCodeProvider } from './BaseOpenCodeProvider';
import { ApiModel } from '../client/types';
import { ZEN_BASE_URL, ApiEndpoint } from '../client/endpoints';

export class OpenCodeZenProvider extends BaseOpenCodeProvider {
  constructor(context: vscode.ExtensionContext) {
    super(context, 'zen', 'OpenCode Zen');
  }

  get vendor(): string { return 'opencode-zen'; }
  get displayName(): string { return 'OpenCode Zen'; }
  get endpoint(): ApiEndpoint { return ZEN_BASE_URL; }
  get keyName(): 'zenKey' { return 'zenKey'; }

  filterModels(models: ApiModel[]): ApiModel[] {
    return models.filter(m => !m.id.includes('free') && !m.id.includes('pickle'));
  }
}
