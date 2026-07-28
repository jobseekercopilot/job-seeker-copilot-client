import { Injectable, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { Observable } from "rxjs";
import {
  ReportingSummaryResponse,
  UcJournalResponse,
} from "../api/reporting-gateway";

@Injectable({ providedIn: "root" })
export class ReportingService {
  private readonly http = inject(HttpClient);

  summary(): Observable<ReportingSummaryResponse> {
    return this.http.get<ReportingSummaryResponse>("/api/v1/reports/summary");
  }

  ucJournal(): Observable<UcJournalResponse> {
    return this.http.get<UcJournalResponse>("/api/v1/reports/uc-journal");
  }
}
