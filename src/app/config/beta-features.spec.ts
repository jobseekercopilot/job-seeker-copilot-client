import {betaFeatures} from './beta-features';
import {routes} from '../app.routes';

describe('Full application capability states', () => {
  it('fails closed for capabilities without authoritative contracts', () => {
    expect(betaFeatures.documentGeneration).toBe(false);
    expect(betaFeatures.reporting).toBe(false);
    expect(betaFeatures.payments).toBe(false);
  });

  it('enables the contract-backed first-checkpoint paths', () => {
    expect(betaFeatures.userManagement).toBe(true);
    expect(betaFeatures.locationLookup).toBe(true);
    expect(betaFeatures.jobFinder).toBe(true);
  });

  it('restores the canonical full-application routes behind the root session gate', () => {
    expect(routes.map(route => route.path)).toEqual([
      'dashboard',
      'payment/success',
      'payment/cancel',
      'payment',
      'payment/history',
      'tokens',
      'tokens/history',
      '',
    ]);
  });
});
