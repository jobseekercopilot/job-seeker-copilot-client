import {LEGACY_SESSION_STORAGE_KEYS, removeLegacySessionData} from './browser-storage';

describe('legacy browser session cleanup', () => {
  it('removes every legacy session and profile key from every browser store', () => {
    const removedFromLocal: string[] = [];
    const removedFromSession: string[] = [];

    removeLegacySessionData(
      {removeItem: key => removedFromLocal.push(key)},
      {removeItem: key => removedFromSession.push(key)},
    );

    expect(removedFromLocal).toEqual(LEGACY_SESSION_STORAGE_KEYS);
    expect(removedFromSession).toEqual(LEGACY_SESSION_STORAGE_KEYS);
  });
});
