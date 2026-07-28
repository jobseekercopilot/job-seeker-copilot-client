import type {UserProfile} from '../api';
import {normaliseProfile} from './user-profile.model';

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
    expect(profile.workPreferences?.commuteRange).toBe(10);
  });
});
