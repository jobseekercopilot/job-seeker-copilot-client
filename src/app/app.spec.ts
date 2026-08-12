import {provideHttpClient} from '@angular/common/http';
import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {MatDialog} from '@angular/material/dialog';
import {provideRouter, Router} from '@angular/router';
import {of} from 'rxjs';
import type {User} from './api';
import {EvidenceLibraryService, WorkPreferencesWorkplaceArrangementsEnum} from './api';
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
  const wallet = vi.fn(() => of({balanceTokens: 70000}));

  beforeEach(async () => {
    status.set('authenticated');
    user.set({
      id: 'user-1',
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
    wallet.mockClear();

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
          provide: EvidenceLibraryService,
          useValue: {
            listEvidence: () => of([]),
            createEvidence: vi.fn(),
            updateEvidence: vi.fn(),
            confirmEvidence: vi.fn(),
            archiveEvidence: vi.fn(),
            restoreEvidence: vi.fn(),
            hideEvidence: vi.fn(),
            showEvidence: vi.fn(),
            supersedeEvidence: vi.fn(),
          },
        },
        {
          provide: PaymentService,
          useValue: {
            wallet,
            pricing: () => of({plans: []}),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(MatDialog).closeAll();
  });

  it('refreshes and displays AI Credit when the secure session is restored', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(wallet).toHaveBeenCalledWith('user-1', '');
    expect(fixture.componentInstance.aiTokenBalance()).toBe(70000);
    expect(fixture.nativeElement.textContent).toContain('AI Credit: £5.59');
  });

  it('renders the canonical product workspace with honest capability states', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Profile');
    expect(text).toContain('Job search');
    expect(text).toContain('Applications');
    expect(text).toContain('Documents');
    expect(text).toContain('Reporting & job-search evidence');
    expect(text).toContain('AI Credit');
    expect(text).toContain('Fixture-backed');
    expect(text).toContain('Not enabled for this beta');
    expect(searchJobs).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-tab-evidence"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.workspace-tab')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('.workspace-navigation')).toBeNull();

    fixture.nativeElement.querySelector('[data-testid="workspace-tab-applications"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Application tracking');

    fixture.nativeElement.querySelector('[data-testid="workspace-tab-documents"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Documents, storage and export');

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

  it('exposes public account content through one main landmark', () => {
    status.set('anonymous');
    user.set(null);
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[role="main"]')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('app-landing-auth[role="main"]')).not.toBeNull();
  });

  it('announces toast messages through an atomic live region', () => {
    const fixture = TestBed.createComponent(App);
    fixture.componentInstance.toastMessage.set('Profile saved.');
    fixture.componentInstance.toastType.set('success');
    fixture.detectChanges();

    const toast = fixture.nativeElement.querySelector('#toast-notification') as HTMLElement;
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(toast.getAttribute('aria-atomic')).toBe('true');

    fixture.componentInstance.toastType.set('error');
    fixture.detectChanges();
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.getAttribute('aria-live')).toBe('assertive');
  });

  it('makes the Privacy Policy and Terms publicly reachable without restoring a session', async () => {
    window.history.pushState({}, '', '/privacy');
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Privacy Policy');
    expect(fixture.nativeElement.textContent).toContain('Google Maps Platform');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-tab-search"]')).toBeNull();

    window.history.pushState({}, '', '/terms');
    window.dispatchEvent(new PopStateEvent('popstate'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Terms of Use');
    expect(fixture.nativeElement.textContent).toContain('Commute information is an estimate');
    window.history.pushState({}, '', '/dashboard');
  });

  it('enables the documents workspace for validated real OpenAI generation', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.documentGenerationMode.set('REAL_LLM');
    fixture.nativeElement.querySelector('[data-testid="workspace-tab-documents"]').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Real OpenAI generation');
    expect(fixture.nativeElement.querySelector('app-documents-workspace')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain(
      'Document wording is fixture-generated',
    );
  });

  it('preserves search state while mounting only the selected Applications or Documents workspace', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const applicationsTab = fixture.nativeElement.querySelector(
      '[data-testid="workspace-tab-applications"]',
    ) as HTMLButtonElement;
    applicationsTab.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeWorkspaceTab()).toBe('applications');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-applications"]'))
      .not.toBeNull();
    expect((fixture.nativeElement.querySelector(
      '[data-testid="workspace-panel-search"]',
    ) as HTMLElement).hidden).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-documents"]')).toBeNull();
    expect(applicationsTab.classList).toContain('workspace-tab-active');
    expect(applicationsTab.getAttribute('aria-current')).toBe('page');

    const documentsTab = fixture.nativeElement.querySelector(
      '[data-testid="workspace-tab-documents"]',
    ) as HTMLButtonElement;
    documentsTab.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.activeWorkspaceTab()).toBe('documents');
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-documents"]'))
      .not.toBeNull();
    expect((fixture.nativeElement.querySelector(
      '[data-testid="workspace-panel-search"]',
    ) as HTMLElement).hidden).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-applications"]'))
      .toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-experience"]'))
      .toBeNull();
  });

  it('opens one guarded evidence dialog without replacing the centre workspace', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (fixture.nativeElement.querySelector(
      '#manage-experience-evidence',
    ) as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.body.querySelectorAll('app-evidence-library')).toHaveLength(1);
    expect(document.body.querySelector('#experience-evidence-dialog')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-search"]'))
      .not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="workspace-panel-experience"]'))
      .toBeNull();

    fixture.componentInstance.openExperienceAndAchievements('summary');
    expect(document.body.querySelectorAll('app-evidence-library')).toHaveLength(1);
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
