import { Injectable, inject } from '@angular/core';
import { Observable, map, switchMap } from 'rxjs';
import {
  ApplicationRecordResponse,
  CreateTrackedApplicationRequest,
  JobApplicationsService,
  UpdateApplicationStatusRequest,
  WithdrawGeneratedApplicationResponse,
} from '../api/job-finder';
import { Job } from '../models/job-search.model';
import { BrowserSessionService } from './browser-session.service';

export type ApplicationStatus = NonNullable<ApplicationRecordResponse['status']>;
export type ApplicationStatusUpdate = `${UpdateApplicationStatusRequest['status']}`;
export type ApplicationFilter = 'ALL' | 'NEEDS_ACTION' | 'APPLIED' | 'INTERVIEW' | 'OFFERS' | 'ARCHIVED';
export type ApplicationEventType =
  | 'SAVED'
  | 'CV_GENERATED'
  | 'COVER_LETTER_GENERATED'
  | 'DOCUMENTS_UPLOADED'
  | 'MARKED_APPLIED'
  | 'INTERVIEW'
  | 'OFFER'
  | 'UNSUCCESSFUL'
  | 'WITHDRAWN'
  | 'ACCEPTED'
  | 'REJECTED_BY_USER';

export interface TrackedApplication extends ApplicationRecordResponse {
  applicationId?: string;
  canonicalJobId?: string;
  postedAt?: string;
  postedDate?: string;
  source?: string;
  providerName?: string;
  interviewAt?: string;
  offerAt?: string;
  withdrawnAt?: string;
  unsuccessfulAt?: string;
  documentsUploadedAt?: string;
}

export interface ApplicationEvent {
  id: string;
  applicationId?: string;
  timestamp: string;
  eventType: ApplicationEventType;
  label: string;
  jobTitle?: string;
  companyName?: string;
  status?: string;
}

@Injectable({ providedIn: 'root' })
export class ApplicationTrackerService {
  private readonly api = inject(JobApplicationsService);
  private readonly browserSession = inject(BrowserSessionService);

  listApplications(): Observable<TrackedApplication[]> {
    return this.api.getApplications('body', false, {transferCache: false}).pipe(
      map(applications => (applications ?? []).map(application => ({
        ...application,
        applicationId: application.id,
      }))),
    );
  }

  createApplication(job: Job): Observable<TrackedApplication> {
    const request: CreateTrackedApplicationRequest = {
      jobId: this.required(job.canonicalJobId ?? job.id, 'Job identifier'),
      canonicalJobId: this.required(job.canonicalJobId ?? job.id, 'Canonical job identifier'),
      provider: this.required(
        job.primarySource
          ?? job.provider
          ?? job.sources?.[0]?.provider
          ?? job.sources?.[0]?.integrationProvider,
        'Job provider',
      ),
      externalJobId: this.required(
        job.externalJobId ?? job.sources?.[0]?.externalJobId ?? job.id,
        'External job identifier',
      ),
      jobTitle: this.required(job.jobTitle ?? job.title, 'Job title'),
      companyName: this.required(job.companyName ?? job.company, 'Company name'),
      location: job.canonicalLocation?.displayName ?? job.location,
    };

    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.api.createApplication(
        request,
        'body',
        false,
        {transferCache: false},
      )),
      map(record => ({...record, applicationId: record.id})),
    );
  }

  updateStatus(
    applicationId: string,
    status: ApplicationStatusUpdate,
  ): Observable<TrackedApplication> {
    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.api.updateApplicationStatus(
        applicationId,
        {status: status as UpdateApplicationStatusRequest['status']},
        'body',
        false,
        {transferCache: false},
      )),
      map(record => ({...record, applicationId: record.id})),
    );
  }

  withdrawGeneratedApplication(
    applicationId: string,
  ): Observable<WithdrawGeneratedApplicationResponse> {
    return this.browserSession.ensureCsrf().pipe(
      switchMap(() => this.api.withdrawGeneratedApplication(
        applicationId,
        'body',
        false,
        {transferCache: false},
      )),
    );
  }

  eventsForApplications(applications: TrackedApplication[]): ApplicationEvent[] {
    return applications
      .flatMap(application => this.eventsForApplication(application))
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  }

  eventsForApplication(application: TrackedApplication): ApplicationEvent[] {
    const events: ApplicationEvent[] = [];
    const applicationId = application.applicationId ?? application.id;
    const generatedAt = application.createdAt ?? application.updatedAt;

    if (generatedAt && application.cvDocumentId) {
      events.push(this.event(application, 'CV_GENERATED', generatedAt, 'CV generated'));
    }
    if (generatedAt && application.coverLetterDocumentId) {
      events.push(this.event(application, 'COVER_LETTER_GENERATED', generatedAt, 'Cover letter generated'));
    }
    if (application.documentsUploadedAt) {
      events.push(this.event(application, 'DOCUMENTS_UPLOADED', application.documentsUploadedAt, 'Documents uploaded'));
    }
    if (application.appliedAt) {
      events.push(this.event(application, 'MARKED_APPLIED', application.appliedAt, 'Application marked as applied'));
    }

    const status = application.status;
    const statusAt = application.updatedAt ?? application.appliedAt ?? application.createdAt;
    if (statusAt && status === 'SAVED') {
      events.push(this.event(application, 'SAVED', application.createdAt ?? statusAt, 'Saved to applications'));
    }
    if (statusAt && status === 'INTERVIEW') {
      events.push(this.event(application, 'INTERVIEW', application.interviewAt ?? statusAt, 'Interview marked or scheduled'));
    }
    if (statusAt && status === 'OFFER') {
      events.push(this.event(application, 'OFFER', application.offerAt ?? statusAt, 'Offer marked'));
    }
    if (statusAt && status === 'UNSUCCESSFUL') {
      events.push(this.event(application, 'UNSUCCESSFUL', application.unsuccessfulAt ?? statusAt, 'Application marked unsuccessful'));
    }
    if (statusAt && status === 'WITHDRAWN') {
      events.push(this.event(application, 'WITHDRAWN', application.withdrawnAt ?? statusAt, 'Application withdrawn'));
    }
    if (statusAt && status === 'ACCEPTED') {
      events.push(this.event(application, 'ACCEPTED', statusAt, 'Offer accepted'));
    }
    if (statusAt && status === 'REJECTED_BY_USER') {
      events.push(this.event(application, 'REJECTED_BY_USER', statusAt, 'Offer declined'));
    }

    return events.map((event, index) => ({
      ...event,
      id: `${applicationId ?? 'application'}-${event.eventType}-${index}-${event.timestamp}`,
    }));
  }

  journalPreview(events: ApplicationEvent[], limit = 8): string {
    return events
      .slice(0, limit)
      .map(event => `${this.formatJournalTimestamp(event.timestamp)} - ${this.journalText(event)}`)
      .join('\n');
  }

  private event(
    application: TrackedApplication,
    eventType: ApplicationEventType,
    timestamp: string,
    label: string,
  ): ApplicationEvent {
    return {
      id: '',
      applicationId: application.applicationId ?? application.id,
      timestamp,
      eventType,
      label,
      jobTitle: application.jobTitle,
      companyName: application.companyName,
      status: application.status,
    };
  }

  private journalText(event: ApplicationEvent): string {
    const job = event.jobTitle || 'this role';
    const company = event.companyName || 'the employer';
    switch (event.eventType) {
      case 'SAVED':
        return `Saved ${job} at ${company} to applications.`;
      case 'CV_GENERATED':
        return `Generated CV for ${job} at ${company}.`;
      case 'COVER_LETTER_GENERATED':
        return `Generated cover letter for ${job} at ${company}.`;
      case 'DOCUMENTS_UPLOADED':
        return `Uploaded documents for ${job} application.`;
      case 'MARKED_APPLIED':
        return `Marked ${job} at ${company} as applied.`;
      case 'INTERVIEW':
        return `Interview scheduled for ${job} at ${company}.`;
      case 'OFFER':
        return `Offer marked for ${job} at ${company}.`;
      case 'UNSUCCESSFUL':
        return `Marked ${job} at ${company} as unsuccessful.`;
      case 'WITHDRAWN':
        return `Withdrew application for ${job} at ${company}.`;
      case 'ACCEPTED':
        return `Accepted offer for ${job} at ${company}.`;
      case 'REJECTED_BY_USER':
        return `Declined offer for ${job} at ${company}.`;
    }
  }

  private formatJournalTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month} ${hours}:${minutes}`;
  }

  private required(value: string | undefined | null, label: string): string {
    const normalized = value?.trim();
    if (!normalized) throw new Error(`${label} is missing from this job result.`);
    return normalized;
  }
}
