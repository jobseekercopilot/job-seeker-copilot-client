import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const sha256 = (contents) => createHash('sha256').update(contents).digest('hex');

export async function verifyContractManifest(rootDir = defaultRoot) {
  const lockPath = resolve(rootDir, 'contracts/contracts.lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));

  if (lock.schemaVersion !== 1 || !Array.isArray(lock.contracts) || lock.contracts.length === 0) {
    throw new Error('contracts.lock.json must contain at least one schemaVersion 1 contract');
  }
  if (!/^https:\/\/repo1\.maven\.org\//.test(lock.generator?.artifactUrl ?? '') ||
      !/^[a-f0-9]{64}$/.test(lock.generator?.artifactSha256 ?? '') ||
      !/^\d+\.\d+\.\d+$/.test(lock.generator?.engineVersion ?? '')) {
    throw new Error('contracts.lock.json must pin a Maven generator URL, version, and SHA-256');
  }

  for (const contract of lock.contracts) {
    const contractPath = resolve(rootDir, contract.path);
    const contents = await readFile(contractPath);
    const actualHash = sha256(contents);
    if (actualHash !== contract.sha256) {
      throw new Error(`${contract.id} checksum mismatch: expected ${contract.sha256}, got ${actualHash}`);
    }

    const document = JSON.parse(contents.toString('utf8'));
    if (document.info?.version !== contract.version) {
      throw new Error(`${contract.id} version mismatch: expected ${contract.version}, got ${document.info?.version ?? 'missing'}`);
    }
    for (const requiredPath of contract.requiredPaths) {
      if (!document.paths?.[requiredPath]) {
        throw new Error(`${contract.id} is missing required path ${requiredPath}`);
      }
    }
  }

  return lock;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyContractManifest()
    .then((lock) => console.log(`Verified ${lock.contracts.length} pinned OpenAPI contracts.`))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
