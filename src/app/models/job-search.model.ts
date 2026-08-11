import type { Job as GeneratedJob } from '../api/job-finder';

export type {
  Aspirations,
  JobSearchRequest,
  ReedJobSearchResponse,
  SalaryExpectation,
  TargetRoleJobResults,
  WorkPreferences
} from '../api/job-finder';

export interface Job extends GeneratedJob {
  applicationVersion?: number;
}

export type { ReedJobSearchResponse as JobSearchResponse } from '../api/job-finder';
