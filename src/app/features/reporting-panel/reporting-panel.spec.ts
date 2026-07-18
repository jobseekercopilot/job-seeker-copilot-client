import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ReportingPanelComponent } from './reporting-panel';
import { ReportingService } from '../../services/reporting.service';

describe('ReportingPanelComponent', () => {
  let requestedUserId = '';
  const reportingService = {
    summary: (userId: string) => {
      requestedUserId = userId;
      return of({
        userId: 'user-1',
        applicationSummary: {
          total: 4,
          applied: 2,
          interview: 1,
          offer: 1,
        },
        activityTimeline: [
          {
            occurredAt: new Date('2026-10-05T09:00:00'),
            text: 'Applied for Software Developer at Matchtech.',
          },
        ],
        commitmentProgress: {
          requiredHours: 35,
          completedHours: 4.5,
          remainingHours: 30.5,
          percentageComplete: 13,
          remainingText: '30.5 hours remaining this week.',
        },
        ucJournalPreview: '05/10/2026 - Applied for Software Developer at Matchtech.',
      });
    },
  };

  beforeEach(async () => {
    requestedUserId = '';
    await TestBed.configureTestingModule({
      imports: [ReportingPanelComponent],
      providers: [{ provide: ReportingService, useValue: reportingService }],
    }).compileComponents();
  });

  it('renders returned reporting data', () => {
    const fixture = TestBed.createComponent(ReportingPanelComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(requestedUserId).toBe('user-1');
    expect(text).toContain('Your job search progress');
    expect(text).toContain('Applications');
    expect(text).toContain('4');
    expect(text).toContain('Applied for Software Developer at Matchtech.');
    expect(text).toContain('05/10/2026 - Applied for Software Developer at Matchtech.');
    expect(text).toContain('13%');
  });
});
