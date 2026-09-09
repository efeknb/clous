#!/usr/bin/env node

import { createInterface, type Interface } from 'readline';
import { ClousClient } from '../ClousClient';
import type { ClousConfig, ConfigSchema } from '../types';

const colors = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  red: '\u001b[31m',
  muted: '\u001b[90m',
};

type Output = NodeJS.WritableStream;

export interface CliDependencies {
  input?: NodeJS.ReadableStream;
  output?: Output;
  error?: Output;
  createClient?: (config?: ClousConfig) => ClousClient;
}

interface ParsedCommand {
  name: string;
  args: string[];
  flags: Set<string>;
}

function parseCommand(argv: string[]): ParsedCommand {
  const tokens = argv.slice(2);
  const positional: string[] = [];
  const flags = new Set<string>();

  for (const token of tokens) {
    if (token.startsWith('--')) {
      flags.add(token.slice(2));
    } else {
      positional.push(token);
    }
  }

  return {
    name: positional.shift() || '',
    args: positional,
    flags,
  };
}

function write(output: Output, message: string): void {
  output.write(`${message}\n`);
}

function color(enabled: boolean, value: string, tone: keyof typeof colors): string {
  return enabled ? `${colors[tone]}${value}${colors.reset}` : value;
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('Invalid JSON input. Use a valid JSON object, array, or primitive value.');
  }
}

function createDefaultClient(dependencies: CliDependencies): ClousClient {
  return (dependencies.createClient || ((config?: ClousConfig) => new ClousClient(config)))({
    store: {
      directory: process.env.CLOUS_STORE_DIR || './clous-data',
      walEnabled: process.env.CLOUS_WAL_ENABLED !== 'false',
    },
    logLevel: 'warn',
  });
}

export class ClousCli {
  private readonly input: NodeJS.ReadableStream;
  private readonly output: Output;
  private readonly error: Output;
  private readonly useColor: boolean;
  private readonly createClient: (config?: ClousConfig) => ClousClient;

  constructor(dependencies: CliDependencies = {}) {
    this.input = dependencies.input || process.stdin;
    this.output = dependencies.output || process.stdout;
    this.error = dependencies.error || process.stderr;
    this.useColor = Boolean(this.output === process.stdout && process.env.NO_COLOR === undefined);
    this.createClient = dependencies.createClient || ((_config?: ClousConfig) => createDefaultClient(dependencies));
  }

  async run(argv: string[] = process.argv): Promise<number> {
    const command = parseCommand(argv);

    if (command.flags.has('help') || command.name === 'help') {
      this.printHelp();
      return 0;
    }

    if (!command.name) {
      return this.runInteractive();
    }

    const client = this.createClient();
    try {
      await client.init();
      await this.runCommand(client, command);
      return 0;
    } catch (error) {
      write(this.error, color(this.useColor, `Error: ${(error as Error).message}`, 'red'));
      return 1;
    } finally {
      await client.shutdown();
    }
  }

  private async runInteractive(): Promise<number> {
    const client = this.createClient();
    const reader = createInterface({ input: this.input, output: this.output });

    try {
      await client.init();
      let running = true;
      while (running) {
        this.printDashboard(client);
        const selection = (await this.ask(reader, 'Select an action [p/s/c/t/r/e/h/q]: ')).trim().toLowerCase();
        try {
          running = await this.runMenuAction(client, reader, selection);
        } catch (error) {
          write(this.error, color(this.useColor, `Error: ${(error as Error).message}`, 'red'));
          await this.pause(reader);
        }
      }
      return 0;
    } finally {
      reader.close();
      await client.shutdown();
    }
  }

  private async runCommand(client: ClousClient, command: ParsedCommand): Promise<void> {
    switch (command.name) {
      case 'status':
        this.printStatus(client);
        return;
      case 'config':
        this.printConfig(client, command.args[0]);
        return;
      case 'store':
        await this.runStoreCommand(client, command.args);
        return;
      case 'checkpoint':
        await this.runCheckpointCommand(client, command.args);
        return;
      case 'transfer':
        await this.runTransferCommand(client, command.args);
        return;
      default:
        throw new Error(`Unknown command "${command.name}". Run "clous --help" for available commands.`);
    }
  }

  private async runMenuAction(
    client: ClousClient,
    reader: Interface,
    selection: string,
  ): Promise<boolean> {
    switch (selection) {
      case 'p':
        await this.runPipelinePrompt(client, reader);
        return true;
      case 's':
        await this.runStorePrompt(client, reader);
        return true;
      case 'c':
        await this.runCheckpointPrompt(client, reader);
        return true;
      case 't':
        await this.runTransferPrompt(client, reader);
        return true;
      case 'r':
        this.printResilience(client);
        await this.pause(reader);
        return true;
      case 'e':
        this.printConfig(client);
        await this.pause(reader);
        return true;
      case 'h':
      case '?':
        this.printHelp();
        await this.pause(reader);
        return true;
      case 'q':
        return false;
      default:
        write(this.output, color(this.useColor, 'Unknown selection. Press h for help.', 'yellow'));
        return true;
    }
  }

  private async runPipelinePrompt(client: ClousClient, reader: Interface): Promise<void> {
    const input = parseJson(await this.ask(reader, 'Pipeline input JSON array: '));
    const result = await client.pipeline(input).execute();
    write(this.output, formatJson(result));
    await this.pause(reader);
  }

  private async runStorePrompt(client: ClousClient, reader: Interface): Promise<void> {
    const collection = await this.ask(reader, 'Collection: ');
    const key = await this.ask(reader, 'Key: ');
    const value = parseJson(await this.ask(reader, 'Value JSON: '));
    await client.store.save(collection, key, value);
    write(this.output, color(this.useColor, 'Value saved.', 'green'));
    await this.pause(reader);
  }

  private async runCheckpointPrompt(client: ClousClient, reader: Interface): Promise<void> {
    const checkpoint = await client.store.checkpoint();
    write(this.output, formatJson(checkpoint));
    await this.pause(reader);
  }

  private async runTransferPrompt(client: ClousClient, reader: Interface): Promise<void> {
    const destination = await this.ask(reader, 'Destination: ');
    const data = parseJson(await this.ask(reader, 'Transfer data JSON: '));
    const result = await client.transfer.send({ destination, data });
    write(this.output, formatJson(result));
    await this.pause(reader);
  }

  private async runStoreCommand(client: ClousClient, args: string[]): Promise<void> {
    const action = args[0];
    if (action === 'list') {
      write(this.output, formatJson(client.store.collections()));
      return;
    }
    if (action === 'get' && args.length >= 3) {
      write(this.output, formatJson(client.store.get(args[1], args[2])));
      return;
    }
    if (action === 'save' && args.length >= 4) {
      await client.store.save(args[1], args[2], parseJson(args.slice(3).join(' ')));
      write(this.output, color(this.useColor, 'Value saved.', 'green'));
      return;
    }
    throw new Error('Usage: clous store list | get <collection> <key> | save <collection> <key> <json>');
  }

  private async runCheckpointCommand(client: ClousClient, args: string[]): Promise<void> {
    switch (args[0]) {
      case 'list':
        write(this.output, formatJson(client.store.listCheckpoints()));
        return;
      case 'create':
        write(this.output, formatJson(await client.store.checkpoint()));
        return;
      case 'restore':
        if (!args[1]) throw new Error('Usage: clous checkpoint restore <id>');
        await client.store.rollback(args[1]);
        write(this.output, color(this.useColor, 'Checkpoint restored.', 'green'));
        return;
      default:
        throw new Error('Usage: clous checkpoint list | create | restore <id>');
    }
  }

  private async runTransferCommand(client: ClousClient, args: string[]): Promise<void> {
    if (args.length < 2) throw new Error('Usage: clous transfer <destination> <json>');
    const result = await client.transfer.send({
      destination: args[0],
      data: parseJson(args.slice(1).join(' ')),
    });
    write(this.output, formatJson(result));
  }

  private printDashboard(client: ClousClient): void {
    write(this.output, '');
    write(this.output, color(this.useColor, '  C L O U S', 'cyan'));
    write(this.output, color(this.useColor, '  Reliable data processing terminal', 'muted'));
    write(this.output, '');
    this.printStatus(client);
    write(this.output, '');
    write(this.output, color(this.useColor, '  [p] Pipeline  [s] Store  [c] Checkpoint  [t] Transfer', 'bold'));
    write(this.output, color(this.useColor, '  [r] Resilience  [e] Environment  [h] Help  [q] Quit', 'bold'));
  }

  private printStatus(client: ClousClient): void {
    const stats = client.store.stats();
    write(this.output, `  Store: ${stats.collections} collections, ${stats.totalItems} items`);
    write(this.output, `  WAL: ${stats.walEntries} entries | Checkpoints: ${stats.checkpoints}`);
    write(this.output, `  Data directory: ${process.env.CLOUS_STORE_DIR || './clous-data'}`);
  }

  private printResilience(client: ClousClient): void {
    write(this.output, 'Circuit breaker:');
    write(this.output, formatJson(client.transfer.getCircuitBreakerStats()));
    write(this.output, 'Rate limiter:');
    write(this.output, formatJson(client.transfer.getRateLimiterInfo()));
  }

  private printConfig(client: ClousClient, action?: string): void {
    if (action === 'validate') {
      const schema: ConfigSchema = {};
      const result = client.config.validate(schema);
      write(this.output, formatJson(result));
      return;
    }
    write(this.output, formatJson(client.config.getAll()));
  }

  private printHelp(): void {
    write(this.output, 'Clous CLI');
    write(this.output, '');
    write(this.output, 'Usage: clous [command] [arguments]');
    write(this.output, '');
    write(this.output, 'Commands:');
    write(this.output, '  clous                         Open the interactive dashboard');
    write(this.output, '  clous status                  Show store and runtime status');
    write(this.output, '  clous config [validate]       Show or validate configuration');
    write(this.output, '  clous store list              List collections');
    write(this.output, '  clous store get <c> <key>     Read a stored value');
    write(this.output, '  clous store save <c> <key> <json>');
    write(this.output, '  clous checkpoint list|create|restore <id>');
    write(this.output, '  clous transfer <url> <json>  Transfer JSON data');
    write(this.output, '');
    write(this.output, 'Interactive shortcuts: p pipeline, s store, c checkpoint, t transfer, r resilience, e environment, q quit');
  }

  private ask(reader: Interface, prompt: string): Promise<string> {
    return new Promise((resolve) => reader.question(prompt, resolve));
  }

  private pause(reader: Interface): Promise<string> {
    return this.ask(reader, 'Press Enter to return to the menu...');
  }
}

if (require.main === module) {
  new ClousCli().run().then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    process.stderr.write(`Fatal error: ${(error as Error).message}\n`);
    process.exitCode = 1;
  });
}
