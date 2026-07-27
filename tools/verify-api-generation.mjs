import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative, resolve} from 'node:path';
import {generateApiClients} from './generate-api-clients.mjs';

async function generatedFiles(root, outputs) {
  const files = new Map();

  async function visit(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        files.set(relative(root, path), await readFile(path));
      } else {
        throw new Error(`Generated output contains unsupported entry ${path}`);
      }
    }
  }

  for (const output of outputs) {
    await visit(resolve(root, output));
  }
  return files;
}

function compareGeneratedFiles(first, second) {
  const firstPaths = [...first.keys()].sort();
  const secondPaths = [...second.keys()].sort();
  if (JSON.stringify(firstPaths) !== JSON.stringify(secondPaths)) {
    throw new Error('Generated client file lists differ between identical runs.');
  }

  for (const path of firstPaths) {
    if (!first.get(path).equals(second.get(path))) {
      throw new Error(`Generated client is not byte-for-byte reproducible: ${path}`);
    }
  }
  return firstPaths.length;
}

const fixtureRoot = await mkdtemp(join(tmpdir(), 'jsc-api-generation-'));
const firstRoot = join(fixtureRoot, 'first');
const secondRoot = join(fixtureRoot, 'second');

try {
  const lock = await generateApiClients(firstRoot);
  await generateApiClients(secondRoot);
  const outputs = [...new Set(lock.contracts.map(({output}) => output))];
  const first = await generatedFiles(firstRoot, outputs);
  const second = await generatedFiles(secondRoot, outputs);
  const count = compareGeneratedFiles(first, second);
  console.log(`Verified ${count} generated files are byte-for-byte reproducible.`);
} finally {
  await rm(fixtureRoot, {recursive: true, force: true});
}
