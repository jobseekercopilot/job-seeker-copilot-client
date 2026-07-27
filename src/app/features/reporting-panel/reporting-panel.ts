import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { ReportingSummaryResponse } from '../../api/reporting-gateway';
import { ReportingService } from '../../services/reporting.service';
import {
  ApplicationEvent,
  ApplicationTrackerService,
  TrackedApplication,
} from '../../services/application-tracker.service';

@Component({
  selector: 'app-reporting-panel',
  standalone: true,
  imports: [CommonModule],
  host: {
    'data-demo-focus': 'app-reporting-panel',
    'data-demo-focus-id': 'reporting-panel'
  },
  templateUrl: './reporting-panel.html',
  styleUrls: ['./reporting-panel.css'],
})
export class ReportingPanelComponent {
  userId = input<string>('');
  authToken = input<string>('');

  private readonly reportingService = inject(ReportingService);
  private readonly applicationTracker = inject(ApplicationTrackerService);
  summary = signal<ReportingSummaryResponse | null>(null);
  applications = signal<TrackedApplication[]>([]);
  applicationEvents = signal<ApplicationEvent[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);
  copied = signal(false);

  displayActivity = computed(() => {
    const events = this.applicationEvents();
    if (events.length > 0) return events.slice(0, 10);
    return (this.summary()?.activityTimeline ?? []).map((item, index) => ({
      id: `summary-${index}-${item.occurredAt}`,
      applicationId: undefined,
      timestamp: String(item.occurredAt ?? ''),
      eventType: 'MARKED_APPLIED' as const,
      label: item.text || item.status || 'Application updated',
      jobTitle: item.jobTitle,
      companyName: item.companyName,
      status: item.status,
    }));
  });

  displayJournal = computed(() => {
    const events = this.applicationEvents();
    if (events.length > 0) return this.applicationTracker.journalPreview(events);
    return this.summary()?.ucJournalPreview ?? '';
  });

  pct(value: number | undefined, total: number | undefined): number {
    if (!total || !value) return 0;
    return Math.round((value / total) * 100);
  }

  constructor() {
    effect(() => {
      const currentUserId = this.userId();
      const currentToken = this.authToken();
      if (currentUserId || currentToken) {
        this.load(currentUserId, currentToken);
      }
    });
  }

  refresh(): void {
    const currentUserId = this.userId();
    const currentToken = this.authToken();
    if (currentUserId || currentToken) {
      this.load(currentUserId, currentToken);
    }
  }

  copyJournal(): void {
    const text = this.displayJournal();
    if (!text) return;

    navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    });
  }

  private load(userId: string, token: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.reportingService.summary(userId, token).subscribe({
      next: (response) => {
        this.summary.set(response);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.errorMessage(err));
        this.loading.set(false);
      },
    });

    this.applicationTracker.listApplications().subscribe({
      next: applications => {
        this.applications.set(applications);
        this.applicationEvents.set(this.applicationTracker.eventsForApplications(applications));
      },
      error: err => console.warn('Unable to load application activity events:', err),
    });
  }

  private errorMessage(error: unknown): string {
    if (typeof error !== 'object' || error === null) {
      return 'Reporting data is unavailable.';
    }

    const status = 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
    const body = 'error' in error ? (error as { error?: unknown }).error : undefined;
    if (typeof body === 'object' && body !== null && 'message' in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim()) {
        return status ? `Reporting data is unavailable (${status}): ${message}` : message;
      }
    }
    return status ? `Reporting data is unavailable (${status}).` : 'Reporting data is unavailable.';
  }
}
