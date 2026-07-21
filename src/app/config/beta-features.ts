export const betaFeatures = {
  userManagement: true,
  locationLookup: true,
  jobFinder: false,
  documentGeneration: false,
  reporting: false,
  payments: false,
} as const;

export type BetaFeature = keyof typeof betaFeatures;
