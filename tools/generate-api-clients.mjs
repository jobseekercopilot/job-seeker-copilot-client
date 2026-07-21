import {rm} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyContractManifest} from './contract-manifest.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = await verifyContractManifest(rootDir);
const generator = resolve(rootDir, 'node_modules/.bin/openapi-generator-cli');

await rm(resolve(rootDir, 'src/app/api'), {recursive: true, force: true});

for (const contract of lock.contracts) {
  const result = spawnSync(generator, [
    'generate',
    '-i', resolve(rootDir, contract.path),
    '-g', lock.generator.generatorName,
    '-o', resolve(rootDir, contract.output),
    `--additional-properties=${lock.generator.additionalProperties}`,
  ], {cwd: rootDir, stdio: 'inherit'});

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`OpenAPI generation failed for ${contract.id} with exit code ${result.status}`);
  }
}

console.log(`Generated ${lock.contracts.length} API clients from verified contracts.`);
