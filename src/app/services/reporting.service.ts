import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ReportingSummaryResponse,
  UcJournalResponse,
} from '../../generated/api/reporting-gateway';

@Injectable({ providedIn: 'root' })
export class ReportingService {
  private readonly http = inject(HttpClient);

  summary(userId: string, token = ''): Observable<ReportingSummaryResponse> {
    return this.http.get<ReportingSummaryResponse>('/api/v1/reports/summary', {
      headers: this.headers(userId, token),
    });
  }

  ucJournal(userId: string, token = ''): Observable<UcJournalResponse> {
    return this.http.get<UcJournalResponse>('/api/v1/reports/uc-journal', {
      headers: this.headers(userId, token),
    });
  }

  private headers(userId: string, token: string): HttpHeaders {
    let headers = new HttpHeaders();
    if (userId) {
      headers = headers.set('X-User-Id', userId);
    }
    if (token) {
      headers = headers.set('Authorization', token.startsWith('Bearer ') ? token : `Bearer ${token}`);
    }
    return headers;
  }
}
