import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    args[key] = value;
    index += 1;
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));

const requiredKeys = [
  'version',
  'change-summary',
  'breaking-changes',
  'commit-sha',
  'repository',
  'output',
];

for (const key of requiredKeys) {
  if (!args[key]) {
    throw new Error(`Missing required argument: --${key}`);
  }
}

const templatePath = path.resolve('.github/release-notes-public-beta.md');
const outputPath = path.resolve(args.output);

const template = await fs.readFile(templatePath, 'utf8');
const rendered = template
  .replaceAll('{{VERSION}}', args.version)
  .replaceAll('{{CHANGE_SUMMARY}}', args['change-summary'])
  .replaceAll('{{BREAKING_CHANGES}}', args['breaking-changes'])
  .replaceAll('{{COMMIT_SHA}}', args['commit-sha'])
  .replaceAll('{{REPOSITORY}}', args.repository);

await fs.writeFile(outputPath, rendered);
console.log(`Wrote release notes to ${outputPath}`);
