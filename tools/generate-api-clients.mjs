import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyContractManifest} from './contract-manifest.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generatorDir = resolve(rootDir, '.cache/openapi-generator');

const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');

async function verifiedGeneratorJar(lock) {
  const generator = resolve(generatorDir, `${lock.generator.engineVersion}.jar`);
  try {
    const cached = await readFile(generator);
    if (sha256(cached) === lock.generator.artifactSha256) return generator;
    await rm(generator, {force: true});
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await mkdir(generatorDir, {recursive: true});
  const response = await fetch(lock.generator.artifactUrl);
  if (!response.ok) {
    throw new Error(`Unable to download OpenAPI Generator: HTTP ${response.status}`);
  }
  const downloaded = Buffer.from(await response.arrayBuffer());
  const actualHash = sha256(downloaded);
  if (actualHash !== lock.generator.artifactSha256) {
    throw new Error(`OpenAPI Generator checksum mismatch: expected ${lock.generator.artifactSha256}, got ${actualHash}`);
  }

  const temporaryPath = `${generator}.download`;
  await writeFile(temporaryPath, downloaded, {mode: 0o600});
  await rename(temporaryPath, generator);
  return generator;
}

export async function generateApiClients(outputRoot = rootDir) {
  const lock = await verifyContractManifest(rootDir);
  const verifiedGenerator = await verifiedGeneratorJar(lock);

  const outputDirectories = [
    ...new Set(lock.contracts.map(({output}) => resolve(outputRoot, output))),
  ].sort((left, right) => left.length - right.length);

  for (const outputDirectory of outputDirectories) {
    await rm(outputDirectory, {recursive: true, force: true});
  }

  for (const contract of lock.contracts) {
    const result = spawnSync('java', [
      '-jar', verifiedGenerator,
      'generate',
      '-i', resolve(rootDir, contract.path),
      '-g', lock.generator.generatorName,
      '-o', resolve(outputRoot, contract.output),
      `--additional-properties=${lock.generator.additionalProperties}`,
    ], {cwd: rootDir, stdio: 'inherit'});

    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`OpenAPI generation failed for ${contract.id} with exit code ${result.status}`);
    }
  }

  return lock;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputRootArgument = process.argv.find((argument) => argument.startsWith('--output-root='));
  const outputRoot = outputRootArgument
    ? resolve(outputRootArgument.slice('--output-root='.length))
    : rootDir;

  generateApiClients(outputRoot)
    .then((lock) => console.log(`Generated ${lock.contracts.length} API clients from verified contracts.`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
