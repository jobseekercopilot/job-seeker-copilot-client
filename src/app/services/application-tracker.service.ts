import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, catchError, map, of, switchMap, throwError } from 'rxjs';
import { ApplicationRecordResponse, UpdateApplicationStatusRequest } from '../api/job-finder';
import { JobService, WithdrawGeneratedApplicationResponse } from './job.service';

export type ApplicationStatus = NonNullable<ApplicationRecordResponse['status']>;
export type ApplicationFilter = 'ALL' | 'NEEDS_ACTION' | 'APPLIED' | 'INTERVIEW' | 'OFFERS' | 'ARCHIVED';
export type ApplicationEventType =
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
  private readonly http = inject(HttpClient);
  private readonly jobService = inject(JobService);

  listApplications(userId: string, token: string): Observable<TrackedApplication[]> {
    if (!userId) return of([]);
    const headers = this.headers(token, userId);
    const encodedUserId = encodeURIComponent(userId);

    return this.http.get<TrackedApplication[]>(`/api/jobs/applications/user/${encodedUserId}`, { headers }).pipe(
      catchError(() => this.http.get<TrackedApplication[]>(`/api/v1/applications/user/${encodedUserId}`, { headers })),
      map(applications => (applications ?? []).map(application => ({
        ...application,
        applicationId: application.applicationId ?? application.id,
        canonicalJobId: application.canonicalJobId ?? application.jobId,
      }))),
    );
  }

  updateStatus(
    applicationId: string,
    status: UpdateApplicationStatusRequest['status'],
    token: string,
    userId: string,
  ): Observable<TrackedApplication> {
    return this.jobService.updateApplicationStatus(applicationId, status, token, userId).pipe(
      map(record => ({ ...record, applicationId: record.id }))
    );
  }

  withdrawGeneratedApplication(
    applicationId: string,
    token: string,
    userId: string,
  ): Observable<WithdrawGeneratedApplicationResponse> {
    return this.jobService.withdrawGeneratedApplication(applicationId, token, userId);
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

  private headers(token: string, userId: string): HttpHeaders {
    let headers = new HttpHeaders();
    if (token) {
      headers = headers.set('Authorization', token.startsWith('Bearer ') ? token : `Bearer ${token}`);
    }
    if (userId) {
      headers = headers.set('X-User-Id', userId);
    }
    return headers;
  }
}
