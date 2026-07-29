import {
  WorkPreferencesEmploymentTypesEnum,
  WorkPreferencesWorkingPatternsEnum,
  type UserProfile,
} from '../api';
import {normaliseProfile, profileToSearchText} from './user-profile.model';

describe('normaliseProfile', () => {
  it('accepts an account profile with empty structured aspirations', () => {
    const profile = normaliseProfile({
      skills: [],
      qualifications: [],
      roles: [],
      aspirations: {
        targetRoles: [],
        targetWeeklyHours: undefined,
      },
      workPreferences: null,
    } as unknown as UserProfile);

    expect(profile.aspirations?.targetRoles).toEqual([]);
    expect(profile.workPreferences).toBeUndefined();
  });

  it('includes employment types and working patterns in the search projection', () => {
    const searchText = profileToSearchText({
      skills: [],
      qualifications: [],
      roles: [],
      workPreferences: {
        employmentTypes: new Set([WorkPreferencesEmploymentTypesEnum.Permanent]),
        workingPatterns: new Set([WorkPreferencesWorkingPatternsEnum.FullTime]),
      },
    });

    expect(JSON.parse(searchText.workPrefs)).toEqual(expect.objectContaining({
      employmentTypes: ['PERMANENT'],
      workingPatterns: ['FULL_TIME'],
    }));
  });
});
