import {betaFeatures} from './beta-features';

describe('User Management beta features', () => {
  it('fails closed for capabilities without authoritative contracts', () => {
    expect(betaFeatures.jobFinder).toBe(false);
    expect(betaFeatures.documentGeneration).toBe(false);
    expect(betaFeatures.reporting).toBe(false);
  });

  it('enables only the contract-backed beta path', () => {
    expect(betaFeatures.userManagement).toBe(true);
    expect(betaFeatures.locationLookup).toBe(true);
  });
});
