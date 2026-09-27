import { scaffoldToolPlugin, type ScaffoldParameterSpec } from './scaffold-tool';

function printUsage(): void {
  console.log(
    'Usage: pnpm scaffold:tool <name> --description "<description>" ' +
    '[--tool-name <snake_case_name>] [--param name:type:description[:required]]...\n\n' +
    'Example:\n' +
    '  pnpm scaffold:tool weather-lookup --description "Look up current weather for a city." ' +
    '--param city:string:"City name":required',
  );
}

function parseArgs(argv: string[]): { name: string; description: string; toolName?: string; parameters: ScaffoldParameterSpec[] } {
  const [name, ...rest] = argv;
  if (!name || name.startsWith('--')) {
    printUsage();
    process.exit(1);
  }

  let description = '';
  let toolName: string | undefined;
  const parameters: ScaffoldParameterSpec[] = [];

  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--description') {
      description = rest[++i] ?? '';
    } else if (flag === '--tool-name') {
      toolName = rest[++i];
    } else if (flag === '--param') {
      const raw = rest[++i] ?? '';
      const [paramName, type, desc, requiredFlag] = raw.split(':');
      if (!paramName || !type || !desc) {
        console.error(`Invalid --param "${raw}". Expected name:type:description[:required].`);
        process.exit(1);
      }
      parameters.push({
        name: paramName,
        type: type as ScaffoldParameterSpec['type'],
        description: desc,
        required: requiredFlag === 'required',
      });
    }
  }

  if (!description) {
    console.error('Missing required --description.');
    printUsage();
    process.exit(1);
  }

  return { name, description, toolName, parameters };
}

function main(): void {
  const { name, description, toolName, parameters } = parseArgs(process.argv.slice(2));

  try {
    const result = scaffoldToolPlugin({ name, description, toolName, parameters });
    console.log(`Created plugins/tools/${result.pluginName}/ (tool name: ${result.toolName})`);
    for (const file of result.createdFiles) {
      console.log(`  plugins/tools/${file}`);
    }
    console.log('\nNext steps:');
    console.log('  1. Implement the TODO in index.ts.');
    console.log('  2. pnpm build && restart the app — the plugin loader only discovers plugins at startup.');
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
