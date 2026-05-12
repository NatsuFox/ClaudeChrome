import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentStartupOptions } from './agent-runtime.js';

export interface ResolvedCodexChatSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  localInstructionContext: string;
  sources: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    instructions: string[];
  };
}

export interface ResolvedClaudeChatSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  localInstructionContext: string;
  sources: {
    apiBaseUrl: string;
    apiKey: string;
    model: string;
    instructions: string[];
  };
}

export interface ResolveCodexChatSettingsOptions {
  startupOptions: AgentStartupOptions;
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

interface ParsedTomlConfig {
  model?: string;
  modelProvider?: string;
  providers: Map<string, ParsedTomlProvider>;
}

interface ParsedTomlProvider {
  baseUrl?: string;
  envKey?: string;
  wireApi?: string;
}

interface ParsedClaudeSettings {
  model?: string;
}

interface InstructionFile {
  path: string;
  label: string;
}

const DEFAULT_MODEL = 'gpt-5.1-codex';
const OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
const MAX_INSTRUCTION_FILE_CHARS = 8_000;
const MAX_TOTAL_INSTRUCTION_CHARS = 28_000;

function expandHome(value: string, homeDir: string): string {
  if (value === '~') {
    return homeDir;
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

function resolveHome(env: NodeJS.ProcessEnv): string {
  return env.HOME || env.USERPROFILE || os.homedir();
}

function resolveCodexHome(env: NodeJS.ProcessEnv): string {
  return path.resolve(expandHome(env.CODEX_HOME?.trim() || path.join(resolveHome(env), '.codex'), resolveHome(env)));
}

function resolveClaudeHome(env: NodeJS.ProcessEnv): string {
  const configured = env.CLAUDECHROME_CLAUDE_CONFIG_DIR?.trim() || env.CLAUDE_CONFIG_DIR?.trim();
  return path.resolve(expandHome(configured || path.join(resolveHome(env), '.claude'), resolveHome(env)));
}

function stripTomlComment(line: string): string {
  let quote: 'single' | 'double' | null = null;
  let escaping = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaping) {
      escaping = false;
      continue;
    }
    if (char === '\\' && quote === 'double') {
      escaping = true;
      continue;
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? null : 'double';
      continue;
    }
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? null : 'single';
      continue;
    }
    if (char === '#' && quote == null) {
      return line.slice(0, index);
    }
  }

  return line;
}

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const body = trimmed.slice(1, -1);
    return trimmed.startsWith('"')
      ? body.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      : body;
  }
  const bare = /^[A-Za-z0-9_./:@-]+$/.test(trimmed) ? trimmed : undefined;
  return bare;
}

function parseCodexConfigToml(configPath: string): ParsedTomlConfig {
  const parsed: ParsedTomlConfig = { providers: new Map() };
  if (!fs.existsSync(configPath)) {
    return parsed;
  }

  let section = '';
  for (const rawLine of fs.readFileSync(configPath, 'utf8').split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = /^\[([^\]]+)]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    const assignmentMatch = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!assignmentMatch) {
      continue;
    }
    const [, key, rawValue] = assignmentMatch;
    const value = parseTomlString(rawValue);
    if (value == null) {
      continue;
    }

    if (!section) {
      if (key === 'model') {
        parsed.model = value;
      } else if (key === 'model_provider') {
        parsed.modelProvider = value;
      }
      continue;
    }

    const providerMatch = /^model_providers\.([^.[\]]+)$/.exec(section);
    if (!providerMatch) {
      continue;
    }

    const providerName = providerMatch[1];
    const provider = parsed.providers.get(providerName) ?? {};
    if (key === 'base_url') {
      provider.baseUrl = value;
    } else if (key === 'env_key') {
      provider.envKey = value;
    } else if (key === 'wire_api') {
      provider.wireApi = value;
    }
    parsed.providers.set(providerName, provider);
  }

  return parsed;
}

function readAuthJsonApiKey(codexHome: string): string {
  const authPath = path.join(codexHome, 'auth.json');
  if (!fs.existsSync(authPath)) {
    return '';
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(authPath, 'utf8')) as Record<string, unknown>;
    return typeof parsed.OPENAI_API_KEY === 'string' ? parsed.OPENAI_API_KEY.trim() : '';
  } catch {
    return '';
  }
}

function readClaudeSettings(claudeHome: string): ParsedClaudeSettings {
  const settingsPath = path.join(claudeHome, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    return {
      model: typeof parsed.model === 'string' ? parsed.model.trim() : undefined,
    };
  } catch {
    return {};
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return '';
}

function ancestorsForCwd(cwd: string): string[] {
  const resolved = path.resolve(cwd || process.cwd());
  const ancestors: string[] = [];
  let current = resolved;
  while (true) {
    ancestors.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return ancestors;
}

function pushInstructionFile(files: InstructionFile[], seen: Set<string>, filePath: string, label: string): void {
  const resolved = path.resolve(filePath);
  if (seen.has(resolved) || !fs.existsSync(resolved)) {
    return;
  }
  try {
    if (!fs.statSync(resolved).isFile()) {
      return;
    }
  } catch {
    return;
  }
  seen.add(resolved);
  files.push({ path: resolved, label });
}

function collectMarkdownFiles(dirPath: string, limit = 40): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dirPath)) {
    return out;
  }
  const visit = (dir: string): void => {
    if (out.length >= limit) {
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(next);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(next);
      }
      if (out.length >= limit) {
        return;
      }
    }
  };
  visit(dirPath);
  return out;
}

function collectLocalInstructionFiles(cwd: string, env: NodeJS.ProcessEnv): InstructionFile[] {
  const files: InstructionFile[] = [];
  const seen = new Set<string>();
  const codexHome = resolveCodexHome(env);
  const claudeHome = resolveClaudeHome(env);

  pushInstructionFile(files, seen, path.join(codexHome, 'AGENTS.md'), 'Codex user instructions');
  pushInstructionFile(files, seen, path.join(claudeHome, 'CLAUDE.md'), 'Claude user memory');

  for (const rulePath of collectMarkdownFiles(path.join(claudeHome, 'rules'))) {
    pushInstructionFile(files, seen, rulePath, 'Claude user rule');
  }

  for (const ancestor of ancestorsForCwd(cwd)) {
    pushInstructionFile(files, seen, path.join(ancestor, 'AGENTS.md'), 'Codex project instructions');
    pushInstructionFile(files, seen, path.join(ancestor, '.codex', 'AGENTS.md'), 'Codex project instructions');
    pushInstructionFile(files, seen, path.join(ancestor, 'CLAUDE.md'), 'Claude project memory');
    pushInstructionFile(files, seen, path.join(ancestor, '.claude', 'CLAUDE.md'), 'Claude project memory');
    pushInstructionFile(files, seen, path.join(ancestor, 'CLAUDE.local.md'), 'Claude local project memory');
    for (const rulePath of collectMarkdownFiles(path.join(ancestor, '.claude', 'rules'))) {
      pushInstructionFile(files, seen, rulePath, 'Claude project rule');
    }
  }

  return files;
}

export function buildLocalInstructionContext(cwd: string, env: NodeJS.ProcessEnv = process.env): { text: string; sources: string[] } {
  const sections: string[] = [];
  const sources: string[] = [];
  let remaining = MAX_TOTAL_INSTRUCTION_CHARS;

  for (const file of collectLocalInstructionFiles(cwd, env)) {
    if (remaining <= 0) {
      break;
    }

    let content: string;
    try {
      content = fs.readFileSync(file.path, 'utf8').trim();
    } catch {
      continue;
    }
    if (!content) {
      continue;
    }

    const clipped = content.slice(0, Math.min(MAX_INSTRUCTION_FILE_CHARS, remaining));
    const truncated = clipped.length < content.length ? '\n[Truncated by ClaudeChrome]' : '';
    sections.push(`### ${file.label}: ${file.path}\n${clipped}${truncated}`);
    sources.push(file.path);
    remaining -= clipped.length;
  }

  if (sections.length === 0) {
    return { text: '', sources };
  }

  return {
    text: [
      'Local agent configuration inherited by ClaudeChrome:',
      ...sections,
    ].join('\n\n'),
    sources,
  };
}

export function resolveCodexChatSettings(options: ResolveCodexChatSettingsOptions): ResolvedCodexChatSettings {
  const env = options.env ?? process.env;
  const codexHome = resolveCodexHome(env);
  const config = parseCodexConfigToml(path.join(codexHome, 'config.toml'));
  const provider = config.modelProvider
    ? config.providers.get(config.modelProvider)
    : config.providers.get('openai');
  const providerEnvKey = provider?.envKey?.trim();
  const providerEnvApiKey = providerEnvKey ? env[providerEnvKey]?.trim() : '';
  const authApiKey = readAuthJsonApiKey(codexHome);
  const localInstructions = buildLocalInstructionContext(options.cwd, env);

  const apiBaseUrl = firstNonEmpty(
    options.startupOptions.apiBaseUrl,
    env.CLAUDECHROME_OPENAI_BASE_URL,
    provider?.baseUrl,
    env.OPENAI_BASE_URL,
    OPENAI_BASE_URL,
  ).replace(/\/+$/, '');
  const apiKey = firstNonEmpty(
    options.startupOptions.apiKey,
    env.CLAUDECHROME_OPENAI_API_KEY,
    providerEnvApiKey,
    authApiKey,
    env.OPENAI_API_KEY,
  );
  const model = firstNonEmpty(
    options.startupOptions.model,
    env.CLAUDECHROME_CODEX_MODEL,
    config.model,
    env.OPENAI_MODEL,
    DEFAULT_MODEL,
  );

  return {
    apiBaseUrl,
    apiKey,
    model,
    localInstructionContext: localInstructions.text,
    sources: {
      apiBaseUrl: options.startupOptions.apiBaseUrl?.trim()
        ? 'panel'
        : env.CLAUDECHROME_OPENAI_BASE_URL?.trim()
          ? 'CLAUDECHROME_OPENAI_BASE_URL'
          : provider?.baseUrl
            ? path.join(codexHome, 'config.toml')
            : env.OPENAI_BASE_URL?.trim()
              ? 'OPENAI_BASE_URL'
              : 'default',
      apiKey: options.startupOptions.apiKey?.trim()
        ? 'panel'
        : env.CLAUDECHROME_OPENAI_API_KEY?.trim()
          ? 'CLAUDECHROME_OPENAI_API_KEY'
          : providerEnvApiKey
            ? providerEnvKey || 'provider env_key'
            : authApiKey
              ? path.join(codexHome, 'auth.json')
              : env.OPENAI_API_KEY?.trim()
                ? 'OPENAI_API_KEY'
                : 'missing',
      model: options.startupOptions.model?.trim()
        ? 'panel'
        : env.CLAUDECHROME_CODEX_MODEL?.trim()
          ? 'CLAUDECHROME_CODEX_MODEL'
          : config.model
            ? path.join(codexHome, 'config.toml')
            : env.OPENAI_MODEL?.trim()
              ? 'OPENAI_MODEL'
              : 'default',
      instructions: localInstructions.sources,
    },
  };
}

export function resolveClaudeChatSettings(options: ResolveCodexChatSettingsOptions): ResolvedClaudeChatSettings {
  const env = options.env ?? process.env;
  const claudeHome = resolveClaudeHome(env);
  const settings = readClaudeSettings(claudeHome);
  const localInstructions = buildLocalInstructionContext(options.cwd, env);

  const apiBaseUrl = firstNonEmpty(
    options.startupOptions.apiBaseUrl,
    env.CLAUDECHROME_ANTHROPIC_BASE_URL,
    env.ANTHROPIC_BASE_URL,
    ANTHROPIC_BASE_URL,
  ).replace(/\/+$/, '');
  const apiKey = firstNonEmpty(
    options.startupOptions.apiKey,
    env.CLAUDECHROME_ANTHROPIC_API_KEY,
    env.ANTHROPIC_API_KEY,
  );
  const model = firstNonEmpty(
    options.startupOptions.model,
    env.CLAUDECHROME_CLAUDE_MODEL,
    settings.model,
    env.ANTHROPIC_MODEL,
    DEFAULT_CLAUDE_MODEL,
  );

  return {
    apiBaseUrl,
    apiKey,
    model,
    localInstructionContext: localInstructions.text,
    sources: {
      apiBaseUrl: options.startupOptions.apiBaseUrl?.trim()
        ? 'panel'
        : env.CLAUDECHROME_ANTHROPIC_BASE_URL?.trim()
          ? 'CLAUDECHROME_ANTHROPIC_BASE_URL'
          : env.ANTHROPIC_BASE_URL?.trim()
            ? 'ANTHROPIC_BASE_URL'
            : 'default',
      apiKey: options.startupOptions.apiKey?.trim()
        ? 'panel'
        : env.CLAUDECHROME_ANTHROPIC_API_KEY?.trim()
          ? 'CLAUDECHROME_ANTHROPIC_API_KEY'
          : env.ANTHROPIC_API_KEY?.trim()
            ? 'ANTHROPIC_API_KEY'
            : 'missing',
      model: options.startupOptions.model?.trim()
        ? 'panel'
        : env.CLAUDECHROME_CLAUDE_MODEL?.trim()
          ? 'CLAUDECHROME_CLAUDE_MODEL'
          : settings.model
            ? path.join(claudeHome, 'settings.json')
            : env.ANTHROPIC_MODEL?.trim()
              ? 'ANTHROPIC_MODEL'
              : 'default',
      instructions: localInstructions.sources,
    },
  };
}
