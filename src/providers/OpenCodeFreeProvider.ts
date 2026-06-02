import * as vscode from 'vscode';
import { BaseOpenCodeProvider } from './BaseOpenCodeProvider';
import { ApiModel, ApiUsageResponse } from '../client/types';
import { ZEN_BASE_URL, ApiEndpoint } from '../client/endpoints';

export class OpenCodeFreeProvider extends BaseOpenCodeProvider {
  constructor(context: vscode.ExtensionContext) {
    super(context, 'free', 'OpenCode Free');
  }

  get vendor(): string { return 'opencode-free'; }
  get displayName(): string { return 'OpenCode Free'; }
  get endpoint(): ApiEndpoint { return ZEN_BASE_URL; }
  get keyName(): 'zenKey' { return 'zenKey'; }

  filterModels(models: ApiModel[]): ApiModel[] {
    return models.filter(m => m.id.includes('free') || m.id.includes('pickle'));
  }

  protected inferFamily(id: string): string {
    if (id.includes('deepseek')) return 'deepseek';
    if (id.includes('mimo')) return 'mimo';
    if (id.includes('qwen')) return 'qwen';
    if (id.includes('minimax')) return 'minimax';
    if (id.includes('nemotron')) return 'nvidia';
    if (id.includes('pickle')) return 'pickle';
    return id.split('-')[0];
  }
}
