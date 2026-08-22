import {Component, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormBuilder, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {JobFinderGatewayService} from '../../gateways/job-finder-gateway';
import {JobSearchRequest, Job, Aspirations, WorkPreferences, SalaryExpectation} from '../../models/job-search.model';

@Component({
  selector: 'app-job-seeker-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './job-seeker-dashboard.html',
  styleUrls: ['./job-seeker-dashboard.css']
})
export class JobSeekerDashboardComponent {
  private fb = inject(FormBuilder);
  private jobFinderGateway = inject(JobFinderGatewayService);

  searchForm: FormGroup = this.fb.group({
    desiredRoles: ['', Validators.required],
    industries: [''],
    salaryMin: [null],
    salaryMax: [null],
    currency: ['USD'],
    locations: [''],
    employmentType: [[]],
    remotePreference: ['HYBRID'],
    companySize: [[]],
    culture: ['']
  });
  jobs: Job[] = [];
  loading = false;
  error: string | null = null;
  totalResults = 0;

  onSubmit(): void {
    if (this.searchForm.invalid) {
      return;
    }

    this.loading = true;
    this.error = null;

    const formValue = this.searchForm.value;
    const salaryExpectation: SalaryExpectation = {
      min: formValue.salaryMin || 0,
      max: formValue.salaryMax || 0,
      currency: formValue.currency || 'USD'
    };

    const aspirations: Aspirations = {
      desiredRoles: this.parseCommaSeparated(formValue.desiredRoles),
      industries: this.parseCommaSeparated(formValue.industries),
      salaryExpectation,
      locations: this.parseCommaSeparated(formValue.locations)
    };

    const workPreferences: WorkPreferences = {
      employmentType: formValue.employmentType || [],
      remotePreference: formValue.remotePreference || 'HYBRID',
      companySize: formValue.companySize || [],
      culture: this.parseCommaSeparated(formValue.culture)
    };

    const request: JobSearchRequest = {
      aspirations,
      workPreferences
    };

    this.jobFinderGateway.searchJobs(request).subscribe({
      next: (response) => {
        this.jobs = response.jobs ?? [];
        this.totalResults = response.totalResults ?? 0;
        this.loading = false;
      },
      error: () => {
        this.error = 'Failed to search jobs. Please try again.';
        this.loading = false;
        console.error('Job search failed');
      }
    });
  }

  private parseCommaSeparated(value: string): string[] {
    if (!value) return [];
    return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
  }

  formatSalary(salary?: { min?: number; max?: number; currency?: string }): string {
    if (salary?.min == null || salary.max == null) return 'Salary not specified';
    return `${salary.currency ?? 'GBP'} ${salary.min.toLocaleString()} - ${salary.max.toLocaleString()}`;
  }

  formatDate(dateString?: string): string {
    if (!dateString) return 'Date unknown';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  getMatchScoreColor(score?: number): string {
    if (score == null) return 'inherit';
    if (score >= 0.8) return 'green';
    if (score >= 0.6) return 'orange';
    return 'red';
  }
}
