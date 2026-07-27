import {ChangeDetectionStrategy, Component, inject, input, OnInit, signal} from '@angular/core';
import type {Job} from '../../api/job-finder';
import {JobService} from '../../services/job.service';

@Component({
  selector: 'app-beta-job-search',
  templateUrl: './beta-job-search.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BetaJobSearchComponent implements OnInit {
  private readonly jobService = inject(JobService);

  readonly skills = input('');
  readonly experience = input('');
  readonly aspirations = input('');
  readonly workPrefs = input('');

  protected readonly jobs = signal<Job[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly expandedJobId = signal<string | null>(null);

  ngOnInit(): void {
    this.search();
  }

  protected search(): void {
    this.loading.set(true);
    this.error.set(null);
    this.jobService.searchJobs(
      this.skills(),
      this.experience(),
      this.aspirations(),
      this.workPrefs(),
    ).subscribe({
      next: response => {
        this.jobs.set(response.jobs ?? response.resultsByTargetRole?.flatMap(group => group.jobs ?? []) ?? []);
        this.loading.set(false);
      },
      error: error => {
        const status = Number((error as {status?: unknown})?.status);
        this.error.set(
          status === 401 || status === 403
            ? 'Your session has expired. Please sign in again.'
            : 'Job matches are temporarily unavailable. Please try again.',
        );
        this.loading.set(false);
      },
    });
  }

  protected jobId(job: Job, index: number): string {
    return job.canonicalJobId ?? job.id ?? `job-${index}`;
  }

  protected title(job: Job): string {
    return job.title ?? job.jobTitle ?? 'Untitled role';
  }

  protected company(job: Job): string {
    return job.companyName ?? job.company ?? 'Company unavailable';
  }

  protected location(job: Job): string {
    return job.canonicalLocation?.displayName ?? job.location ?? 'Location unavailable';
  }

  protected toggle(job: Job, index: number): void {
    const id = this.jobId(job, index);
    this.expandedJobId.update(current => current === id ? null : id);
  }
}
