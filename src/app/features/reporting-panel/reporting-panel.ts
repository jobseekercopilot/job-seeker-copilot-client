import { CommonModule } from "@angular/common";
import { Component, OnInit, computed, inject, signal } from "@angular/core";
import { ReportingSummaryResponse } from "../../api/reporting-gateway";
import { ReportingService } from "../../services/reporting.service";

@Component({
  selector: "app-reporting-panel",
  standalone: true,
  imports: [CommonModule],
  host: {
    "data-demo-focus": "app-reporting-panel",
    "data-demo-focus-id": "reporting-panel",
  },
  templateUrl: "./reporting-panel.html",
  styleUrls: ["./reporting-panel.css"],
})
export class ReportingPanelComponent implements OnInit {
  private readonly reportingService = inject(ReportingService);
  summary = signal<ReportingSummaryResponse | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  copied = signal(false);
  copyError = signal<string | null>(null);

  displayActivity = computed(() =>
    (this.summary()?.activityTimeline ?? []).map((item, index) => ({
      id: `${item.applicationId ?? "evidence"}-${item.eventType ?? index}-${item.occurredAt}`,
      timestamp: String(item.occurredAt ?? ""),
      category: item.evidenceCategory ?? "APPLICATION",
      label: item.text || item.status || "Application updated",
      provider: item.provider,
      jobTitle: item.jobTitle,
      companyName: item.companyName,
      status: item.status,
    })),
  );

  displayJournal = computed(() => this.summary()?.ucJournalPreview ?? "");

  ngOnInit(): void {
    this.load();
  }

  pct(value: number | undefined, total: number | undefined): number {
    if (!total || !value) return 0;
    return Math.round((value / total) * 100);
  }

  refresh(): void {
    this.load();
  }

  copyJournal(): void {
    const text = this.displayJournal();
    if (!text) return;
    this.copyError.set(null);
    if (!navigator.clipboard) {
      this.copyError.set("Clipboard access is unavailable. Select the journal text to copy it manually.");
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }).catch(() => {
      this.copyError.set("The journal could not be copied. Select the text to copy it manually.");
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.reportingService.summary().subscribe({
      next: response => {
        this.summary.set(response);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.errorMessage(err));
        this.loading.set(false);
      },
    });
  }

  private errorMessage(error: unknown): string {
    if (typeof error !== "object" || error === null) return "Reporting data is unavailable.";
    const status = "status" in error ? Number((error as { status?: unknown }).status) : undefined;
    const body = "error" in error ? (error as { error?: unknown }).error : undefined;
    if (typeof body === "object" && body !== null && "message" in body) {
      const message = (body as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return status ? `Reporting data is unavailable (${status}): ${message}` : message;
      }
    }
    return status ? `Reporting data is unavailable (${status}).` : "Reporting data is unavailable.";
  }
}
