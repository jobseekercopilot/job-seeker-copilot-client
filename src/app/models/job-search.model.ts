import type {
  Job as GeneratedJob,
  JobDiscoveryAssessment as GeneratedJobDiscoveryAssessment,
  MatchAssessment as GeneratedMatchAssessment,
  MatchReason as GeneratedMatchReason,
  MatchScoreComponent as GeneratedMatchScoreComponent,
  ProviderDataProvenance as GeneratedProviderDataProvenance,
  ProviderResultStatus as GeneratedProviderResultStatus,
  ReedJobSearchResponse as GeneratedJobSearchResponse,
  SearchFreshness as GeneratedSearchFreshness,
  SearchQualitySummary as GeneratedSearchQualitySummary,
  TargetRoleJobResults as GeneratedTargetRoleJobResults,
} from '../api/job-finder';

export type {
  Aspirations,
  JobSearchRequest,
  SalaryExpectation,
  TargetRoleJobResults,
  WorkPreferences
} from '../api/job-finder';

export interface Job extends GeneratedJob {
  applicationVersion?: number;
}

export type JobMatchReason = GeneratedMatchReason;
export type JobMatchComponent = GeneratedMatchScoreComponent;
export type JobMatchAssessment = GeneratedMatchAssessment;
export type JobDiscoveryAssessment = GeneratedJobDiscoveryAssessment;
export type JobSearchFreshness = GeneratedSearchFreshness;
export type JobSearchQualitySummary = GeneratedSearchQualitySummary;
export type ProviderDataProvenance = GeneratedProviderDataProvenance;

export type ProviderSearchResult = GeneratedProviderResultStatus;

export interface TargetRoleSearchResults extends Omit<
  GeneratedTargetRoleJobResults,
  'jobs' | 'providerResults'
> {
  jobs: Job[];
  providerResults: ProviderSearchResult[];
  qualitySummary?: JobSearchQualitySummary;
}

export interface JobSearchResponse extends Omit<
  GeneratedJobSearchResponse,
  'jobs' | 'resultsByTargetRole' | 'providerResults'
> {
  jobs?: Job[];
  resultsByTargetRole?: TargetRoleSearchResults[];
  providerResults?: ProviderSearchResult[];
  freshness?: JobSearchFreshness;
  qualitySummary?: JobSearchQualitySummary;
}
