import { ClousCli } from '../src/cli/cli';

function outputMock(writes: string[]): NodeJS.WritableStream {
  return {
    write: (value: string) => {
      writes.push(value);
      return true;
    },
  } as NodeJS.WritableStream;
}

describe('Clous CLI', () => {
  test('prints help without initializing a client', async () => {
    const writes: string[] = [];
    const output = outputMock(writes);
    const cli = new ClousCli({ output });

    const exitCode = await cli.run(['node', 'clous', '--help']);
    const outputText = writes.join('');

    expect(exitCode).toBe(0);
    expect(outputText).toContain('Usage: clous [command] [arguments]');
    expect(outputText).toContain('Interactive shortcuts');
  });
});
