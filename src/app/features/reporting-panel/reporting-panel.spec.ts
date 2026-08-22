import { TestBed } from "@angular/core/testing";
import { of } from "rxjs";
import { ReportingPanelComponent } from "./reporting-panel";
import { ReportingService } from "../../services/reporting.service";

describe("ReportingPanelComponent", () => {
  let requestCount = 0;
  const reportingService = {
    summary: () => {
      requestCount += 1;
      return of({
        userId: "user-1",
        applicationSummary: {total: 4, applied: 2, interview: 1, offer: 1},
        activityTimeline: [{
          applicationId: "application-1",
          occurredAt: new Date("2026-10-05T09:00:00"),
          eventType: "STATUS_CHANGED",
          evidenceCategory: "APPLICATION",
          provider: "reed",
          text: "Applied for Software Developer at Matchtech.",
        }],
        commitmentProgress: {
          requiredHours: 35,
          completedHours: 4.5,
          remainingHours: 30.5,
          percentageComplete: 13,
          remainingText: "30.5 hours remaining this week.",
        },
        ucJournalPreview: "05/10/2026 - Applied for Software Developer at Matchtech.",
      });
    },
  };

  beforeEach(async () => {
    requestCount = 0;
    await TestBed.configureTestingModule({
      imports: [ReportingPanelComponent],
      providers: [{ provide: ReportingService, useValue: reportingService }],
    }).compileComponents();
  });

  it("loads from the session-only service and renders persisted evidence", () => {
    const fixture = TestBed.createComponent(ReportingPanelComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(requestCount).toBe(1);
    expect(text).toContain("Your job search progress");
    expect(text).toContain("Applications");
    expect(text).toContain("Applied for Software Developer at Matchtech.");
    expect(text).toContain("Source: reed");
    expect(text).toContain("13%");
    expect(text).toContain("not an official Universal Credit submission");
    const download = fixture.nativeElement.querySelector("a[download]") as HTMLAnchorElement;
    expect(download.getAttribute("href")).toBe("/api/v1/reports/evidence.txt");
  });
});
