import { ChangeDetectionStrategy, Component, input, output, signal, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { JobService } from '../../services/job.service';
import { Job } from '../../models/job-search.model';

@Component({
  selector: 'app-job-results',
  imports: [CommonModule, MatIconModule],
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
        this.jobs.set(response.jobs);
        this.totalResults.set(response.totalResults);
        this.loading.set(false);
        this.notify.emit({
          message: `Found ${response.totalResults} matching job${response.totalResults === 1 ? '' : 's'}.`,
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

  formatSalary(salary: { min: number; max: number; currency: string }): string {
    return `${salary.currency} ${salary.min.toLocaleString()} - ${salary.max.toLocaleString()}`;
  }

  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  matchScoreColor(score: number): string {
    if (score >= 0.8) return 'text-emerald-600';
    if (score >= 0.6) return 'text-amber-600';
    return 'text-rose-600';
  }

  matchScoreBg(score: number): string {
    if (score >= 0.8) return 'bg-emerald-50 border-emerald-200';
    if (score >= 0.6) return 'bg-amber-50 border-amber-200';
    return 'bg-rose-50 border-rose-200';
  }
}