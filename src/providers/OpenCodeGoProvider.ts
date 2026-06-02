import * as vscode from 'vscode';
import { BaseOpenCodeProvider } from './BaseOpenCodeProvider';
import { ApiModel } from '../client/types';
import { GO_BASE_URL, ApiEndpoint } from '../client/endpoints';

export class OpenCodeGoProvider extends BaseOpenCodeProvider {
  constructor(context: vscode.ExtensionContext) {
    super(context, 'go', 'OpenCode Go');
  }

  get vendor(): string { return 'opencode-go'; }
  get displayName(): string { return 'OpenCode Go'; }
  get endpoint(): ApiEndpoint { return GO_BASE_URL; }
  get keyName(): 'goKey' { return 'goKey'; }

  filterModels(models: ApiModel[]): ApiModel[] {
    return models;
  }
}
