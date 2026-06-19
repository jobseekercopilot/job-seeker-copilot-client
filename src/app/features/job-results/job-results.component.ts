import { ChangeDetectionStrategy, Component, input, output, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { JobCardComponent } from '../job-card/job-card.component';
import { JobService } from '../../services/job.service';
import { Job } from '../../models/job-search.model';

@Component({
  selector: 'app-job-results',
  imports: [CommonModule, MatIconModule, JobCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './job-results.component.html',
  styleUrl: './job-results.component.css'
})
export class JobResultsComponent implements OnInit {
  private jobService = inject(JobService);

  // Inputs from the parent App component (profile signals)
  skills = input<string>('');
  experience = input<string>('');
  aspirations = input<string>('');
  workPrefs = input<string>('');
  authToken = input<string>('');

  // Output to notify parent to show a toast
  notify = output<{ message: string; type: 'success' | 'info' | 'error' }>();

  // Reactive state
  jobs = signal<Job[]>([]);
  totalResults = signal(0);
  loading = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    // Auto-trigger search when the component initialises (profile is already loaded)
    this.search();
  }

  trackByJobId(index: number, job: Job): string {
    return job.id;
  }

  private validateJob(job: any): Job | null {
    const requiredFields = ['id', 'title', 'company', 'location', 'salary', 'postedDate', 'description', 'url'];
    const missingFields = requiredFields.filter(field => {
      if (field === 'salary') {
        return !job.salary || typeof job.salary.min !== 'number' || typeof job.salary.max !== 'number';
      }
      return job[field] == null || job[field] === '';
    });

    if (missingFields.length > 0) {
      console.warn(`[JobResults] Skipping malformed job (id: ${job.id || 'unknown'}): missing/empty fields: ${missingFields.join(', ')}`, job);
      return null;
    }

    return job as Job;
  }

  search(): void {
    const token = this.authToken();
    if (!token) {
      this.error.set('Authentication token is missing. Please log in again.');
      return;
    }

    this.loading.set(true);
    this.error.set(null);

    this.jobService.searchJobs(
      this.skills(),
      this.experience(),
      this.aspirations(),
      this.workPrefs(),
      token
    ).subscribe({
      next: (response) => {
        const validJobs: Job[] = [];
        const skippedCount = { value: 0 };

        for (const job of response.jobs) {
          const validated = this.validateJob(job);
          if (validated) {
            validJobs.push(validated);
          } else {
            skippedCount.value++;
          }
        }

        if (skippedCount.value > 0) {
          console.warn(`[JobResults] Filtered out ${skippedCount.value} malformed job(s) out of ${response.jobs.length} total`);
        }

        this.jobs.set(validJobs);
        this.totalResults.set(validJobs.length);
        this.loading.set(false);
        this.notify.emit({
          message: `Found ${validJobs.length} matching job${validJobs.length === 1 ? '' : 's'}.`,
          type: 'success'
        });
      },
      error: (err) => {
        this.loading.set(false);
        const status = err.status;

        if (status === 503) {
          this.error.set('Job search service is temporarily unavailable. Please try again later.');
          this.notify.emit({
            message: 'Job search service is temporarily unavailable. Please try again later.',
            type: 'error'
          });
        } else if (status === 400) {
          this.error.set('Invalid search parameters. Please update your profile and try again.');
          this.notify.emit({
            message: 'Invalid search parameters. Please update your profile and try again.',
            type: 'error'
          });
        } else if (status === 401 || status === 403) {
          this.error.set('Session expired. Please log in again.');
          this.notify.emit({
            message: 'Session expired. Please log in again.',
            type: 'error'
          });
        } else {
          this.error.set('An unexpected error occurred while searching for jobs.');
          this.notify.emit({
            message: 'An unexpected error occurred while searching for jobs.',
            type: 'error'
          });
        }

        console.error('Job search error:', err);
      }
    });
  }

  refresh(): void {
    this.search();
  }

}
