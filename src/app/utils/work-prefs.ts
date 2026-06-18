export interface WorkPreference {
  hours: string;
  postcode: string;
  distance: string;
  region: string;
  adminDistrict: string;
}

export function parseWorkPrefs(prefsStr: string): WorkPreference {
  const defaultPrefs: WorkPreference = {
    hours: 'Full-Time (35-40 hours)',
    postcode: 'LS1 1UR',
    distance: '10 miles',
    region: 'Yorkshire and the Humber',
    adminDistrict: 'Leeds'
  };

  if (!prefsStr || !prefsStr.trim()) {
    return defaultPrefs;
  }

  try {
    const trimmed = prefsStr.trim();
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed);
    }
  } catch (e) {
    // ignore and fallback to legacy parsing
  }

  // Parse legacy format: "Full-Time (35-40 hours) | Postcode: LS1 1UR (10 miles commute)"
  try {
    const parts = prefsStr.split('|');
    const hours = parts[0] ? parts[0].trim() : defaultPrefs.hours;
    let postcode = defaultPrefs.postcode;
    let distance = defaultPrefs.distance;

    if (parts[1]) {
      const postcodePart = parts[1].trim();
      const postcodeMatch = postcodePart.match(/Postcode:\s*([A-Z0-9\s]+)/i);
      if (postcodeMatch && postcodeMatch[1]) {
        postcode = postcodeMatch[1].trim();
      }
      const distanceMatch = postcodePart.match(/\((\d+\s*miles?)\s+commute\)/i);
      if (distanceMatch && distanceMatch[1]) {
        distance = distanceMatch[1].trim();
      }
    }
    return {
      hours,
      postcode,
      distance,
      region: 'Yorkshire and the Humber',
      adminDistrict: 'Leeds'
    };
  } catch (e) {
    return defaultPrefs;
  }
}
