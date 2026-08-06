import { AspirationsTargetWeeklyHoursEnum } from '../api';
import type { Aspirations, Qualification, Role, UserProfile, WorkPreferences } from '../api';

type TargetWeeklyHours = NonNullable<Aspirations['targetWeeklyHours']>;

interface ProfileInputShape {
  skills?: string | string[];
  experience?: string;
  aspirations?: string | UserProfile['aspirations'];
  workPrefs?: string | WorkPreferences;
  qualifications?: Qualification[];
  roles?: Role[];
  workPreferences?: WorkPreferences;
}

export const emptyUserProfile = (): UserProfile => ({
  skills: [],
  qualifications: [],
  roles: []
});

export const splitTags = (value?: string | string[]): string[] => {
  if (Array.isArray(value)) return value.map(v => v.trim()).filter(Boolean);
  return (value || '')
    .split(/[;,]/)
    .map(v => v.trim())
    .filter(Boolean);
};

const targetHoursLabelToEnum = (value?: string): TargetWeeklyHours | undefined => {
  if (!value) return undefined;
  if (value.includes('16-30')) return AspirationsTargetWeeklyHoursEnum.PartTime1630;
  if (value.includes('Under 16')) return AspirationsTargetWeeklyHoursEnum.PartTimeUnder16;
  if (value.includes('Flexible')) return AspirationsTargetWeeklyHoursEnum.Flexible;
  return undefined;
};

const commuteToNumber = (value?: string | number): number | undefined => {
  if (typeof value === 'number') return value;
  const match = `${value || ''}`.match(/\d+/);
  return match ? Number(match[0]) : undefined;
};

const parseWorkPrefs = (value?: string | WorkPreferences): WorkPreferences | undefined => {
  if (value && typeof value === 'object' && 'location' in value) return value as WorkPreferences;
  if (value && typeof value === 'object') {
    const wp = value as Record<string, string | number>;
    return {
      location: {
        postcode: String(wp['postcode'] || '').trim().toUpperCase(),
        region: String(wp['region'] || ''),
        adminDistrict: String(wp['adminDistrict'] || '')
      },
      commuteRange: commuteToNumber(wp['distance'] || wp['commuteRange'])
    };
  }
  if (!value) return undefined;

  try {
    const parsed = JSON.parse(value) as Record<string, string | number>;
    return {
      location: {
        postcode: String(parsed['postcode'] || '').trim().toUpperCase(),
        region: String(parsed['region'] || ''),
        adminDistrict: String(parsed['adminDistrict'] || '')
      },
      commuteRange: commuteToNumber(parsed['distance'] || parsed['commuteRange'])
    };
  } catch {
    return {
      location: {
        postcode: '',
        region: value,
        adminDistrict: ''
      },
      commuteRange: 10
    };
  }
};

export const normaliseProfile = (profile?: ProfileInputShape | UserProfile | null): UserProfile => {
  const base = emptyUserProfile();
  if (!profile) return base;
  const versionedProfile = profile as UserProfile;

  const aspirations = typeof profile.aspirations === 'object' && profile.aspirations !== null
    ? profile.aspirations
    : undefined;

  const hasStoredWorkPrefs = (p: ProfileInputShape | UserProfile): p is ProfileInputShape =>
    'workPrefs' in p;

  const workPreferences = profile.workPreferences
    || (hasStoredWorkPrefs(profile) ? parseWorkPrefs(profile.workPrefs) : undefined);
  const legacyTargetHours = hasStoredWorkPrefs(profile)
    ? targetHoursLabelToEnum(typeof profile.workPrefs === 'string' ? profile.workPrefs : undefined)
    : undefined;
  const targetRoles = aspirations
    ? splitTags(aspirations.targetRoles)
    : splitTags(profile.aspirations as string);
  const normalisedAspirations = aspirations || targetRoles.length > 0 || legacyTargetHours
    ? {
        targetRoles,
        ...(aspirations?.targetWeeklyHours || legacyTargetHours
          ? {targetWeeklyHours: aspirations?.targetWeeklyHours || legacyTargetHours}
          : {}),
      }
    : undefined;

  return {
    ...(versionedProfile.id == null ? {} : {id: versionedProfile.id}),
    ...(versionedProfile.userId == null ? {} : {userId: versionedProfile.userId}),
    ...(versionedProfile.revision == null ? {} : {revision: versionedProfile.revision}),
    ...(versionedProfile.revisionId == null
      ? {}
      : {revisionId: versionedProfile.revisionId}),
    ...(versionedProfile.contentDigest == null
      ? {}
      : {contentDigest: versionedProfile.contentDigest}),
    skills: splitTags(profile.skills),
    qualifications: (profile.qualifications || []).filter(isValidQualification),
    roles: (profile.roles || []).filter(isValidRole),
    ...(normalisedAspirations ? {aspirations: normalisedAspirations} : {}),
    ...(workPreferences ? {
      workPreferences: {
        ...workPreferences,
        ...(workPreferences.location ? {
          location: {
            ...workPreferences.location,
            postcode: workPreferences.location.postcode?.trim().toUpperCase(),
            region: workPreferences.location.region?.trim(),
            adminDistrict: workPreferences.location.adminDistrict?.trim(),
          },
        } : {}),
        ...(commuteToNumber(workPreferences.commuteRange) == null
          ? {}
          : {commuteRange: commuteToNumber(workPreferences.commuteRange)}),
      },
    } : {}),
  };
};

export const isValidQualification = (qualification: Qualification): boolean =>
  Boolean(qualification.qualificationName?.trim() && qualification.issuingBody?.trim() && qualification.status);

export const isValidRole = (role: Role): boolean =>
  Boolean(role.jobTitle?.trim() && role.employer?.trim() && role.status && role.startDate?.trim());

export const serialiseProfile = (profile: UserProfile): UserProfile => ({
  skills: splitTags(profile.skills),
  qualifications: (profile.qualifications || []).filter(isValidQualification),
  roles: (profile.roles || []).filter(isValidRole),
  ...(profile.aspirations ? {
    aspirations: {
      targetRoles: splitTags(profile.aspirations.targetRoles),
      ...(profile.aspirations.targetWeeklyHours
        ? {targetWeeklyHours: profile.aspirations.targetWeeklyHours}
        : {}),
    },
  } : {}),
  ...(profile.workPreferences ? {
    workPreferences: {
      ...profile.workPreferences,
      ...(profile.workPreferences.location ? {
        location: {
          ...profile.workPreferences.location,
          postcode: profile.workPreferences.location.postcode?.trim().toUpperCase(),
          region: profile.workPreferences.location.region?.trim(),
          adminDistrict: profile.workPreferences.location.adminDistrict?.trim(),
        },
      } : {}),
      commuteRange: commuteToNumber(profile.workPreferences.commuteRange),
    },
  } : {}),
});

export const profileToSearchText = (profile: UserProfile) => ({
  skills: (profile.skills || []).join(', '),
  experience: (profile.roles || []).map(role => `${role.jobTitle} at ${role.employer}${role.keyResponsibilities ? ` - ${role.keyResponsibilities}` : ''}`).join('; '),
  aspirations: (profile.aspirations?.targetRoles || []).join(', '),
  workPrefs: JSON.stringify({
    hours: profile.aspirations?.targetWeeklyHours,
    postcode: profile.workPreferences?.location?.postcode,
    distance: profile.workPreferences?.commuteRange == null
      ? undefined
      : `${profile.workPreferences.commuteRange} miles`,
    region: profile.workPreferences?.location?.region,
    adminDistrict: profile.workPreferences?.location?.adminDistrict,
    latitude: profile.workPreferences?.location?.latitude,
    longitude: profile.workPreferences?.location?.longitude,
    employmentTypes: Array.from(profile.workPreferences?.employmentTypes ?? []),
    workingPatterns: Array.from(profile.workPreferences?.workingPatterns ?? []),
    workplaceArrangements: Array.from(profile.workPreferences?.workplaceArrangements ?? []),
  })
});
