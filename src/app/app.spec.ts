import {provideHttpClient} from '@angular/common/http';
import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {provideRouter, Router} from '@angular/router';
import {of} from 'rxjs';
import type {User} from './api';
import {WorkPreferencesWorkplaceArrangementsEnum} from './api';
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
      workPreferences: {
        location: {postcode: 'RG1 1AA'},
        workplaceArrangements: new Set([WorkPreferencesWorkplaceArrangementsEnum.Hybrid]),
      },
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
        workPreferences: {
          location: {postcode: 'RG1 1AA'},
          workplaceArrangements: new Set([WorkPreferencesWorkplaceArrangementsEnum.Hybrid]),
        },
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
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-tab-evidence"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.workspace-tab')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.workspace-navigation')).toBeNull();

    fixture.nativeElement.querySelector('#btn-profile-dropdown').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Experience & achievements');
    expect((fixture.nativeElement.textContent.match(/Sign out/g) ?? [])).toHaveLength(1);
  });

  it('does not expose the dashboard while the secure session is being checked', () => {
    status.set('checking');
    user.set(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Checking your session');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-tab-search"]')).toBeNull();
  });

  it('enables the documents workspace for validated real OpenAI generation', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.documentGenerationMode.set('REAL_LLM');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Real OpenAI generation');
    expect(fixture.nativeElement.querySelector('app-documents-workspace')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Document wording is fixture-generated',
    );
  });

  it('does not mount job search until the required preferences exist', async () => {
    user.set({
      name: 'New User',
      email: 'new@example.test',
      profile: {skills: [], aspirations: {targetRoles: []}},
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(searchJobs).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="search-setup-prompt"]'))
      .not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'We have not sent a job-search request',
    );
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
