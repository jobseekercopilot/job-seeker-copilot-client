import {provideHttpClient} from '@angular/common/http';
import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideRouter} from '@angular/router';
import {of} from 'rxjs';
import type {User} from './api';
import {App} from './app';
import {routes} from './app.routes';
import type {BrowserSessionStatus} from './services/browser-session.service';
import {BrowserSessionService} from './services/browser-session.service';
import {JobService} from './services/job.service';
import {PaymentService} from './services/payment.service';

describe('Full App checkpoint', () => {
  const status = signal<BrowserSessionStatus>('authenticated');
  const user = signal<User | null>({
    name: 'Alex Taylor',
    email: 'alex@example.test',
    profile: {
      skills: ['TypeScript'],
      aspirations: {targetRoles: ['Frontend developer']},
      workPreferences: {location: {postcode: 'RG1 1AA'}},
    },
  });
  const searchJobs = vi.fn(() => of({jobs: [], totalResults: 0}));

  beforeEach(async () => {
    status.set('authenticated');
    user.set({
      name: 'Alex Taylor',
      email: 'alex@example.test',
      profile: {
        skills: ['TypeScript'],
        aspirations: {targetRoles: ['Frontend developer']},
        workPreferences: {location: {postcode: 'RG1 1AA'}},
      },
    });
    searchJobs.mockClear();

    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideRouter(routes),
        {
          provide: BrowserSessionService,
          useValue: {
            status,
            user,
            restore: () => of(status()),
            logout: () => of({statusCode: 200, success: true, message: 'Logged out'}),
            acceptAuthenticatedUser: (next: User) => user.set(next),
            updateCurrentProfile: () => undefined,
            handleAuthenticatedError: () => undefined,
            ensureCsrf: () => of(undefined),
          },
        },
        {provide: JobService, useValue: {searchJobs}},
        {
          provide: PaymentService,
          useValue: {
            wallet: () => of({balanceTokens: 0}),
            pricing: () => of({plans: []}),
          },
        },
      ],
    }).compileComponents();
  });

  it('renders the recognisable full workspace with honest capability states', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Your complete Job Seeker Copilot workspace');
    expect(text).toContain('Profile');
    expect(text).toContain('Job search');
    expect(text).toContain('Job matching & details');
    expect(text).toContain('Application tracking');
    expect(text).toContain('CV & cover-letter generation');
    expect(text).toContain('Documents & export');
    expect(text).toContain('Reporting & evidence');
    expect(text).toContain('AI Credit');
    expect(text).toContain('Payments');
    expect(text).toContain('Fixture-backed');
    expect(text).toContain('Temporarily unavailable');
    expect(text).toContain('Coming next');
    expect(searchJobs).toHaveBeenCalled();
  });

  it('does not expose the dashboard while the secure session is being checked', () => {
    status.set('checking');
    user.set(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Checking your session');
    expect(fixture.nativeElement.querySelector('[data-testid="capability-profile"]')).toBeNull();
  });
});
