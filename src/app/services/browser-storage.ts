export const LEGACY_SESSION_STORAGE_KEYS = [
  'jc_token',
  'jc_user_id',
  'jc_email',
  'jc_profile',
  'jc_name',
  'jc_logged_in',
  'jc_skills',
  'jc_experience',
  'jc_aspirations',
  'jc_prefs',
] as const;

interface RemovableStorage {
  removeItem(key: string): void;
}

export function removeLegacySessionData(...stores: RemovableStorage[]): void {
  for (const store of stores) {
    for (const key of LEGACY_SESSION_STORAGE_KEYS) store.removeItem(key);
  }
}
