import type {UserProfile} from '../api';

export interface SearchReadiness {
  ready: boolean;
  missing: ('targetRole' | 'workplace' | 'location')[];
}

export function searchReadiness(profile: UserProfile | null | undefined): SearchReadiness {
  const targetRoles = profile?.aspirations?.targetRoles ?? [];
  const workplaceArrangements = Array.from(
    profile?.workPreferences?.workplaceArrangements ?? [],
  );
  const location = profile?.workPreferences?.location;
  const hasSearchableLocation = [
    location?.postcode,
    location?.region,
    location?.adminDistrict,
  ].some(value => value?.trim());
  const missing: SearchReadiness['missing'] = [];

  if (!targetRoles.some(role => role.trim().length > 0)) missing.push('targetRole');
  if (workplaceArrangements.length === 0) missing.push('workplace');
  if (!hasSearchableLocation) missing.push('location');

  return {ready: missing.length === 0, missing};
}
