import {provideHttpClient} from '@angular/common/http';
import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideRouter, Router} from '@angular/router';
import {of} from 'rxjs';
import type {User} from './api';
import {App} from './app';
import {routes} from './app.routes';
import type {BrowserSessionStatus} from './services/browser-session.service';
import {BrowserSessionService} from './services/browser-session.service';
import {JobService} from './services/job.service';
import {PaymentService} from './services/payment.service';
import {ApplicationTrackerService} from './services/application-tracker.service';
import {RuntimeConfigurationService} from './services/runtime-configuration.service';

describe('App', () => {
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
          provide: RuntimeConfigurationService,
          useValue: {
            jobSearchMode: () => of({mode: 'FIXTURE'}),
            documentGenerationMode: () => of({mode: 'FIXTURE_LLM'}),
          },
        },
        {
          provide: ApplicationTrackerService,
          useValue: {
            listApplications: () => of([]),
            createApplication: vi.fn(),
            updateStatus: vi.fn(),
          },
        },
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

  it('renders the canonical product workspace with honest capability states', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Profile');
    expect(text).toContain('Job search');
    expect(text).toContain('Application tracking');
    expect(text).toContain('Documents, storage and export');
    expect(text).toContain('Reporting & job-search evidence');
    expect(text).toContain('AI Credit');
    expect(text).toContain('Fixture-backed');
    expect(text).toContain('Not enabled for this beta');
    expect(searchJobs).toHaveBeenCalled();
  });

  it('does not expose the dashboard while the secure session is being checked', () => {
    status.set('checking');
    user.set(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Checking your session');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-tab-search"]')).toBeNull();
  });

  it('leaves a hosted account route after successful sign-in', () => {
    const fixture = TestBed.createComponent(App);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture.componentInstance.publicAccountRoute.set('signin');

    fixture.componentInstance.handleOnboarded({
      name: 'Alex Taylor',
      email: 'alex@example.test',
      profile: {
        skills: [],
        aspirations: {targetRoles: []},
        workPreferences: null,
      } as unknown as NonNullable<User['profile']>,
    });

    expect(fixture.componentInstance.publicAccountRoute()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/dashboard', {replaceUrl: true});
  });
});
