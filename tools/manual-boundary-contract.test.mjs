import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {verifyManualBoundaryContracts} from './manual-boundary-contract.mjs';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function paymentFixture(mutate) {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'jsc-payment-boundary-'));
  const lock = JSON.parse(
    await readFile(resolve(rootDir, 'contracts/manual-boundaries.lock.json'), 'utf8'),
  );
  const payment = lock.contracts.find(({id}) => id === 'payment-gateway');
  const document = JSON.parse(
    await readFile(resolve(rootDir, payment.path), 'utf8'),
  );
  mutate(document);
  const contents = JSON.stringify(document);
  payment.sha256 = createHash('sha256').update(contents).digest('hex');

  await mkdir(dirname(resolve(fixtureRoot, payment.path)), {recursive: true});
  await writeFile(
    resolve(fixtureRoot, 'contracts/manual-boundaries.lock.json'),
    JSON.stringify(lock),
  );
  await writeFile(resolve(fixtureRoot, payment.path), contents);
  return fixtureRoot;
}

test('pins Payment Gateway as an exact-hash non-generated manual boundary', async () => {
  const lock = await verifyManualBoundaryContracts(rootDir);
  assert.equal(lock.contracts.length, 1);
  assert.deepEqual(lock.contracts[0], {
    id: 'payment-gateway',
    boundaryType: 'manual_boundary',
    generatedClient: false,
    version: '2.2.0',
    sourceRepository: 'jobseekercopilot/payment-gateway',
    sourceCommit: '6db53bd9b98cbaac081fdd7c06cf95687f29e222',
    path: 'contracts/payment-gateway/2.2.0/openapi.json',
    sha256: '6df5c1877d429b870ecad5a42a8506b178836fb36af6feda8cd178bc5df0518e',
    requiredPaths: [
      '/api/v2/payments/catalog',
      '/api/v2/payments/wallet',
      '/api/v2/payments/transactions',
      '/api/v2/payments/checkout-readiness',
      '/api/v2/payments/checkout',
      '/api/v2/payments/orders/{orderId}/status',
    ],
  });
});

test('rejects a checkout contract that drops a required acknowledgement', async () => {
  const fixtureRoot = await paymentFixture((document) => {
    document.components.schemas.DocumentCreditCheckoutRequest.required =
      document.components.schemas.DocumentCreditCheckoutRequest.required.filter(
        field => field !== 'cancellationRightLossAcknowledged',
      );
  });

  await assert.rejects(
    verifyManualBoundaryContracts(fixtureRoot),
    /DocumentCreditCheckoutRequest must require exactly/,
  );
});

test('rejects a transaction contract that changes reversal semantics', async () => {
  const fixtureRoot = await paymentFixture((document) => {
    document.components.schemas.Transaction.properties.type.enum =
      document.components.schemas.Transaction.properties.type.enum.filter(
        type => type !== 'REFUND_REVERSAL',
      );
  });

  await assert.rejects(
    verifyManualBoundaryContracts(fixtureRoot),
    /Transaction\.type enum must require exactly/,
  );
});
