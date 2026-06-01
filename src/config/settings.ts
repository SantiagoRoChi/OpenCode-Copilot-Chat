export interface ZenConfig {
  apiKey: string;
  requestTimeout: number;
  enableToolCalling: boolean;
  enableImageInput: boolean;
  parallelToolCalling: boolean;
  agentTemperature: number;
  verboseLogging: boolean;
  autoDetectOpenCode: boolean;
}

export function loadConfig(): ZenConfig {
  const vscode = require('vscode') as typeof import('vscode');
  const config = vscode.workspace.getConfiguration('opencode-zen');

  return {
    apiKey: '',
    requestTimeout: config.get<number>('requestTimeout', 60000),
    enableToolCalling: config.get<boolean>('enableToolCalling', true),
    enableImageInput: config.get<boolean>('enableImageInput', true),
    parallelToolCalling: config.get<boolean>('parallelToolCalling', true),
    agentTemperature: config.get<number>('agentTemperature', 0.0),
    verboseLogging: config.get<boolean>('verboseLogging', false),
    autoDetectOpenCode: config.get<boolean>('autoDetectOpenCode', true),
  };
}
