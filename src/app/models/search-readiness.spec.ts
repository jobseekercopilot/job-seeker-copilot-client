import {WorkPreferencesWorkplaceArrangementsEnum} from '../api';
import {searchReadiness} from './search-readiness';

describe('searchReadiness', () => {
  it('requires a target role and a workplace choice', () => {
    expect(searchReadiness({skills: ['Excel']}).missing).toEqual([
      'targetRole',
      'workplace',
      'location',
    ]);
  });

  it('requires an explicit search location for remote work without inventing one', () => {
    const profile = {
      aspirations: {targetRoles: ['Support analyst']},
      workPreferences: {
        workplaceArrangements: new Set([
          WorkPreferencesWorkplaceArrangementsEnum.Remote,
        ]),
      },
    };
    expect(searchReadiness(profile).missing).toEqual(['location']);
    expect(searchReadiness({
      ...profile,
      workPreferences: {
        ...profile.workPreferences,
        location: {region: 'Leeds'},
      },
    }).ready).toBe(true);
  });

  it('accepts a postcode as the search location for hybrid or on-site work', () => {
    const profile = {
      aspirations: {targetRoles: ['Support analyst']},
      workPreferences: {
        workplaceArrangements: new Set([
          WorkPreferencesWorkplaceArrangementsEnum.Hybrid,
        ]),
      },
    };
    expect(searchReadiness(profile).missing).toEqual(['location']);
    expect(searchReadiness({
      ...profile,
      workPreferences: {
        ...profile.workPreferences,
        location: {postcode: 'LS1 1AA'},
      },
    }).ready).toBe(true);
  });
});
