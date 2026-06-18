export interface SalaryExpectation {
  min: number;
  max: number;
  currency: string;
}

export interface Aspirations {
  desiredRoles: string[];
  industries: string[];
  salaryExpectation: SalaryExpectation;
  locations: string[];
}

export interface WorkPreferences {
  employmentType: string[];
  remotePreference: 'REMOTE' | 'HYBRID' | 'ONSITE';
  companySize: string[];
  culture: string[];
}

export interface JobSearchRequest {
  aspirations: Aspirations;
  workPreferences: WorkPreferences;
}

export interface Job {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: {
    min: number;
    max: number;
    currency: string;
  };
  employmentType: string;
  postedDate: string;
  matchScore: number;
}

export interface JobSearchResponse {
  jobs: Job[];
  totalResults: number;
  page: number;
  pageSize: number;
}