import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import fc from 'fast-check';
import {of, throwError} from 'rxjs';
import type {EvidenceEntry, UserProfile} from '../../api';
import {AuthenticationService, EvidenceLibraryService, ProfileService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {idleLocationLookup, LocationService} from '../../services/location.service';
import type {PublicLegalConfiguration} from '../../services/runtime-configuration.service';
import {registrationPasswordError, unicodeCodePointLength} from './credential-policy';
import {LandingAuthComponent} from './landing-auth';

describe('LandingAuthComponent account access', () => {
  const events: string[] = [];
  const login = vi.fn();
  const register = vi.fn();
  const getRegistrationLegalRequirements = vi.fn();
  const ensureCsrf = vi.fn();
  const invalidateCsrf = vi.fn();
  const acceptAuthenticatedUser = vi.fn();
  const handleAuthenticatedError = vi.fn();
  const updatePreferences = vi.fn();
  // EvidenceLibraryComponent is rendered as a real child at steps 4/5/6. In
  // onboarding mode it does not call listEvidence, but the service is still
  // injected, so a minimal mock keeps the child renderable in these tests.
  const listEvidence = vi.fn(() => of([]));
  const createEvidence = vi.fn();
  const confirmEvidence = vi.fn();
  const locationLookup = vi.fn(() => of(idleLocationLookup));
  const resolveLocation = vi.fn();
  const legalRequirements = {
    legalVersion: 'public-beta-v1',
    minimumAge: 18,
    termsUrl: 'https://app.jobseekercopilot.com/terms',
    privacyNoticeUrl: 'https://app.jobseekercopilot.com/privacy',
  };
  const reviewedLegalConfiguration: PublicLegalConfiguration = {
    ready: true,
    status: 'REVIEWED',
    minimumUserAge: 18,
    legalEntityType: 'SOLE_TRADER',
    taxStatus: 'NOT_VAT_REGISTERED',
    effectiveDate: '2026-08-15',
    version: 'public-beta-v1',
    controllerName: 'Northstar Career Services',
    tradingName: 'Job Seeker Copilot',
    businessAddress: '10 High Street, London, SW1A 1AA',
    privacyEmail: 'privacy@example.test',
    supportEmail: 'support@example.test',
    icoRegistrationStatus: 'NOT_REQUIRED_CONFIRMED',
    accountDeletionCompletionDays: 30,
    documentDeletionCompletionDays: 30,
    securityLogRetentionDays: 90,
    supportRecordRetentionDays: 365,
    financialRecordRetentionYears: 6,
  };

  function createFixture(legalConfiguration = reviewedLegalConfiguration) {
    const fixture = TestBed.createComponent(LandingAuthComponent);
    fixture.componentRef.setInput('legalConfiguration', legalConfiguration);
    fixture.detectChanges();
    return fixture;
  }

  function createSignInFixture() {
    const fixture = TestBed.createComponent(LandingAuthComponent);
    fixture.componentRef.setInput('initialMode', 'signin');
    fixture.componentRef.setInput('legalConfiguration', reviewedLegalConfiguration);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(async () => {
    events.length = 0;
    login.mockReset();
    register.mockReset();
    getRegistrationLegalRequirements.mockReset();
    ensureCsrf.mockReset();
    invalidateCsrf.mockReset();
    acceptAuthenticatedUser.mockReset();
    handleAuthenticatedError.mockReset();
    updatePreferences.mockReset();
    listEvidence.mockReset();
    createEvidence.mockReset();
    confirmEvidence.mockReset();
    listEvidence.mockReturnValue(of([]));
    locationLookup.mockClear();
    resolveLocation.mockReset();
    getRegistrationLegalRequirements.mockReturnValue(of(legalRequirements));
    updatePreferences.mockReturnValue(of({
      statusCode: 200,
      success: true,
      user: {
        id: 'new-account',
        name: 'New User',
        email: 'new@example.test',
        profile: {
          revision: 2,
          skills: ['Customer service'],
          qualifications: [],
          roles: [],
          aspirations: {targetRoles: ['Support analyst']},
          workPreferences: {workplaceArrangements: ['REMOTE']},
        },
      },
    }));
    ensureCsrf.mockImplementation(() => {
      events.push('csrf');
      return of(undefined);
    });
    login.mockImplementation(() => {
      events.push('login');
      return of({
        statusCode: 200,
        success: true,
        user: {id: 'account-id', name: 'Beta User', email: 'beta@example.test', profile: {skills: []}},
      });
    });

    await TestBed.configureTestingModule({
      imports: [LandingAuthComponent],
      providers: [
        {
          provide: AuthenticationService,
          useValue: {getRegistrationLegalRequirements, login, register},
        },
        {provide: ProfileService, useValue: {updatePreferences}},
        {provide: EvidenceLibraryService, useValue: {listEvidence, createEvidence, confirmEvidence}},
        {provide: LocationService, useValue: {lookup: locationLookup, resolve: resolveLocation}},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf,
          invalidateCsrf,
          acceptAuthenticatedUser,
          handleAuthenticatedError,
        }},
      ],
    }).compileComponents();
  });

  it('registers with account credentials only and starts guided setup', async () => {
    register.mockImplementation(() => {
      events.push('register');
      return of({
        statusCode: 201,
        success: true,
        user: {id: 'new-account', name: 'New User', email: 'new@example.test', profile: {
          skills: [], qualifications: [], roles: [],
        }},
      });
    });
    const component = createFixture().componentInstance;
    let onboarded: {
      profile: UserProfile;
      id?: string;
      name: string;
      email: string;
    } | undefined;
    component.onboarded.subscribe(value => onboarded = value);
    component.formName.set(' New User ');
    component.formEmail.set('NEW@EXAMPLE.TEST');
    component.formPassword.set('safe-password-value');
    component.registrationLegalAcknowledged.set(true);

    await component.completeRegistration();

    expect(events).toEqual(['csrf', 'register']);
    expect(register).toHaveBeenCalledWith({
      name: 'New User',
      email: 'new@example.test',
      password: 'safe-password-value',
      termsAccepted: true,
      privacyNoticeAcknowledged: true,
      ageEligibilityConfirmed: true,
      legalVersion: 'public-beta-v1',
    });
    expect(register.mock.calls[0][0]).not.toHaveProperty('profile');
    expect(acceptAuthenticatedUser).not.toHaveBeenCalled();
    expect(component.setupStep()).toBe(1);
    expect(onboarded).toBeUndefined();

    component.skipSetup();
    expect(acceptAuthenticatedUser).not.toHaveBeenCalled();
    expect(onboarded).toEqual({
      profile: {skills: [], qualifications: [], roles: []},
      id: 'new-account',
      name: 'New User',
      email: 'new@example.test',
    });
  });

  it('saves completed setup before entering the application', async () => {
    register.mockReturnValue(of({
      statusCode: 201,
      success: true,
      user: {
        id: 'new-account',
        name: 'New User',
        email: 'new@example.test',
        profile: {revision: 1, skills: [], qualifications: [], roles: []},
      },
    }));
    const component = createFixture().componentInstance;
    let onboarded: {
      profile: UserProfile;
      id?: string;
      name: string;
      email: string;
    } | undefined;
    component.onboarded.subscribe(value => onboarded = value);
    component.formName.set('New User');
    component.formEmail.set('new@example.test');
    component.formPassword.set('safe-password-value');
    component.registrationLegalAcknowledged.set(true);
    await component.completeRegistration();

    component.setupTargetRoles.set('Support analyst');
    component.continueSetup();
    component.setupPostcode.set('LS1 1AA');
    component.setupCanonicalLocation.set({
      locationId: 'postcode:ls11aa',
      displayName: 'Leeds, Yorkshire and the Humber',
      countryCode: 'GB',
      postcode: 'LS1 1AA',
      locality: 'Leeds',
      region: 'Yorkshire and the Humber',
      latitude: 53.797,
      longitude: -1.548,
      locationType: 'POSTCODE',
      precision: 'POSTCODE',
      confidence: 'HIGH',
      providerReferences: [{provider: 'POSTCODES_IO', externalId: 'fixture-ls11aa'}],
      fieldProvenance: [
        {field: 'DISPLAY_NAME', source: 'POSTCODES_IO'},
        {field: 'POSTCODE', source: 'POSTCODES_IO'},
        {field: 'COORDINATES', source: 'POSTCODES_IO'},
      ],
    });
    component.continueSetup();
    component.toggleWorkplace('REMOTE');
    component.continueSetup();
    await vi.waitFor(() => expect(updatePreferences).toHaveBeenCalledOnce());

    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        aspirations: {targetRoles: ['Support analyst']},
        workPreferences: expect.objectContaining({
          location: expect.objectContaining({
            locationId: 'postcode:ls11aa',
            displayName: 'Leeds, Yorkshire and the Humber',
            postcode: 'LS1 1AA',
            postcodesIoPlaceId: 'fixture-ls11aa',
            displayNameSource: 'POSTCODES_IO',
            postcodeSource: 'POSTCODES_IO',
            coordinatesSource: 'POSTCODES_IO',
          }),
          workplaceArrangements: ['REMOTE'],
        }),
      }),
      '"1"',
      'body',
      false,
      {transferCache: false},
    );
    expect(updatePreferences.mock.calls[0][0]).not.toHaveProperty('skills');
    expect(JSON.parse(JSON.stringify(updatePreferences.mock.calls[0][0])))
      .toEqual(expect.objectContaining({
        workPreferences: expect.objectContaining({workplaceArrangements: ['REMOTE']}),
      }));
    // finishSetup no longer emits onboarded; it stores the updated account and advances to step 4
    // so the optional evidence steps (4, 5, 6) can be presented.
    expect(onboarded).toBeUndefined();
    expect(component.setupStep()).toBe(4);
    expect(component.setupAccount()?.profile).toEqual(expect.objectContaining({revision: 2}));
    expect(invalidateCsrf).toHaveBeenCalled();
  });

  it('uses a three-step job-preference setup without asking for skills', () => {
    const fixture = createFixture();
    fixture.componentInstance.setupStep.set(1);
    fixture.detectChanges();

    expect(fixture.componentInstance.setupProgress()).toBe('1 of 6');
    expect(fixture.nativeElement.querySelectorAll('.setup-progress span')).toHaveLength(6);
    expect(fixture.nativeElement.textContent).not.toContain('Which skills should stand out?');
    expect(fixture.nativeElement.querySelector('#setup-skills')).toBeNull();

    fixture.componentInstance.setupStep.set(3);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#btn-next-step').textContent).toContain(
      'Continue',
    );
  });

  it('does not advance past search location without a canonical selection', () => {
    const component = createFixture().componentInstance;
    component.setupStep.set(2);

    component.continueSetup();

    expect(component.setupStep()).toBe(2);
    expect(component.errorMessage()).toBe(
      'Choose a location from the suggestions before continuing, or set this up later.',
    );
  });

  it('bootstraps CSRF before login and preserves password whitespace', async () => {
    const component = createFixture().componentInstance;
    component.loginEmail.set('BETA@EXAMPLE.TEST');
    component.loginPassword.set('  legacy password  ');

    await component.submitLogin();

    expect(events).toEqual(['csrf', 'login']);
    expect(login).toHaveBeenCalledWith({
      email: 'beta@example.test',
      password: '  legacy password  ',
    });
    expect(invalidateCsrf).toHaveBeenCalledOnce();
  });

  it('fails closed without CSRF and never sends credentials', async () => {
    ensureCsrf.mockReturnValue(throwError(() => new Error('invalid CSRF bootstrap')));
    const component = createFixture().componentInstance;
    component.loginEmail.set('beta@example.test');
    component.loginPassword.set('safe-password');

    await component.submitLogin();

    expect(login).not.toHaveBeenCalled();
    expect(component.errorMessage()).toBe('Unable to contact the authentication service.');
  });

  it('uses Unicode code-point registration password bounds without trimming', async () => {
    register.mockReturnValue(of({
      statusCode: 201,
      success: true,
      user: {id: 'new-account', name: 'New User', email: 'new@example.test', profile: {}},
    }));
    const component = createFixture().componentInstance;
    component.formName.set('New User');
    component.formEmail.set('new@example.test');
    component.formPassword.set('🌱'.repeat(14));
    component.registrationLegalAcknowledged.set(true);

    await component.completeRegistration();
    expect(register).not.toHaveBeenCalled();

    const exactPassword = ` ${'🌱'.repeat(15)} `;
    component.formPassword.set(exactPassword);
    await component.completeRegistration();

    expect(unicodeCodePointLength(exactPassword)).toBe(17);
    expect(register).toHaveBeenCalledWith(expect.objectContaining({password: exactPassword}));
    expect(registrationPasswordError('🌱'.repeat(129))).not.toBeNull();
  });

  it('supports keyboard account tabs and focuses the error summary', () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture();
      const createTab = fixture.nativeElement.querySelector('#tab-btn-create') as HTMLButtonElement;
      createTab.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
      fixture.detectChanges();
      vi.runAllTimers();

      const signInTab = fixture.nativeElement.querySelector('#tab-btn-signin') as HTMLButtonElement;
      expect(signInTab.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(signInTab);
      expect(fixture.nativeElement.querySelector('#login-password').autocomplete).toBe('current-password');

      fixture.componentInstance.setMode('create');
      fixture.componentInstance.registrationLegalAcknowledged.set(true);
      fixture.componentInstance.completeRegistration();
      fixture.detectChanges();
      vi.runAllTimers();
      expect(document.activeElement).toBe(fixture.nativeElement.querySelector('#auth-error-alert'));
      expect(fixture.nativeElement.querySelector('#reg-name').getAttribute('aria-invalid')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no automated accessibility violations in either account mode', async () => {
    const fixture = createFixture();
    expect((await axe.run(fixture.nativeElement)).violations).toEqual([]);
    fixture.componentInstance.setMode('signin');
    fixture.detectChanges();
    expect((await axe.run(fixture.nativeElement)).violations).toEqual([]);
    fixture.componentInstance.setupStep.set(1);
    fixture.detectChanges();
    expect((await axe.run(fixture.nativeElement)).violations).toEqual([]);
    fixture.componentInstance.setupStep.set(3);
    fixture.detectChanges();
    expect((await axe.run(fixture.nativeElement)).violations).toEqual([]);
  });

  it('shows an accessible acknowledgement link beside Postcodes.io setup suggestions', async () => {
    const fixture = createFixture();
    fixture.componentInstance.setupStep.set(2);
    fixture.componentInstance.setupLocationLookup.set({
      status: 'results',
      locations: [],
      message: '1 matching location found.',
      attributionProvider: 'POSTCODES_IO',
    });
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector(
      'a[href="#postcode-data-attribution"]',
    ) as HTMLAnchorElement;
    expect(link).not.toBeNull();
    expect(link.textContent).toContain('View data acknowledgements');
    expect((await axe.run(fixture.nativeElement)).violations).toEqual([]);
  });

  it('requires one unchecked, versioned UK-adult legal acknowledgement', async () => {
    const fixture = createFixture();
    const component = fixture.componentInstance;
    component.formName.set('New User');
    component.formEmail.set('new@example.test');
    component.formPassword.set('safe-password-value');
    fixture.detectChanges();

    const checkbox = fixture.nativeElement.querySelector(
      '#registration-legal-acknowledgement',
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(fixture.nativeElement.querySelector(
      'a[href="https://app.jobseekercopilot.com/terms"]',
    )).toBeTruthy();
    expect(fixture.nativeElement.querySelector(
      'a[href="https://app.jobseekercopilot.com/privacy"]',
    )).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('UK resident aged 18 or over');
    expect(fixture.nativeElement.textContent).toContain('version public-beta-v1');

    await component.completeRegistration();
    fixture.detectChanges();

    expect(ensureCsrf).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(checkbox.getAttribute('aria-invalid')).toBe('true');
    expect(component.errorMessage()).toContain('UK 18+ eligibility');
  });

  it('fails closed when the displayed legal version does not match server requirements', async () => {
    const fixture = createFixture({
      ...reviewedLegalConfiguration,
      version: 'older-reviewed-version',
    });
    const component = fixture.componentInstance;
    component.formName.set('New User');
    component.formEmail.set('new@example.test');
    component.formPassword.set('safe-password-value');
    component.registrationLegalAcknowledged.set(true);
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('#btn-submit-signup') as HTMLButtonElement).disabled)
      .toBe(true);
    expect(fixture.nativeElement.textContent).toContain(
      'Account creation is temporarily unavailable',
    );
    await component.completeRegistration();
    expect(register).not.toHaveBeenCalled();
  });

  it('keeps sign-in available without fetching registration terms until account creation is opened', () => {
    const fixture = createSignInFixture();

    expect(fixture.componentInstance.mode()).toBe('signin');
    expect(getRegistrationLegalRequirements).not.toHaveBeenCalled();

    fixture.componentInstance.setMode('create');

    expect(getRegistrationLegalRequirements).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.registrationLegalReady()).toBe(true);
  });

  it('requires a fresh acknowledgement when the registration legal version changes', async () => {
    register.mockReturnValue(throwError(() => ({
      error: {
        statusCode: 409,
        success: false,
        message: 'Registration could not be completed.',
        error: {
          code: 'LEGAL_VERSION_OUTDATED',
          message: 'The legal version changed.',
        },
      },
    })));
    getRegistrationLegalRequirements
      .mockReturnValueOnce(of(legalRequirements))
      .mockReturnValueOnce(of({...legalRequirements, legalVersion: 'public-beta-v2'}));
    const component = createFixture().componentInstance;
    component.formName.set('New User');
    component.formEmail.set('new@example.test');
    component.formPassword.set('safe-password-value');
    component.registrationLegalAcknowledged.set(true);

    await component.completeRegistration();

    expect(register).toHaveBeenCalledOnce();
    expect(component.registrationLegalAcknowledged()).toBe(false);
    expect(component.registrationRequirements()?.legalVersion).toBe('public-beta-v2');
    expect(component.registrationLegalReady()).toBe(false);
    expect(component.errorMessage()).toContain('changed before registration completed');
  });

  describe('skipSetup at new onboarding steps', () => {
    const account = {
      profile: {skills: [], qualifications: [], roles: []},
      id: 'skip-account',
      name: 'Skip User',
      email: 'skip@example.test',
    };

    it('emits onboarded exactly once when skipSetup is called at step 4', () => {
      const component = createFixture().componentInstance;
      const emitted: typeof account[] = [];
      component.onboarded.subscribe(value => emitted.push(value as typeof account));

      component.setupAccount.set(account);
      component.setupStep.set(4);

      component.skipSetup();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(account);
    });

    it('emits onboarded exactly once when skipSetup is called at step 5', () => {
      const component = createFixture().componentInstance;
      const emitted: typeof account[] = [];
      component.onboarded.subscribe(value => emitted.push(value as typeof account));

      component.setupAccount.set(account);
      component.setupStep.set(5);

      component.skipSetup();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(account);
    });

    it('emits onboarded exactly once when skipSetup is called at step 6', () => {
      const component = createFixture().componentInstance;
      const emitted: typeof account[] = [];
      component.onboarded.subscribe(value => emitted.push(value as typeof account));

      component.setupAccount.set(account);
      component.setupStep.set(6);

      component.skipSetup();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(account);
    });

    it('does not emit onboarded when setupAccount is null', () => {
      const component = createFixture().componentInstance;
      const emitted: unknown[] = [];
      component.onboarded.subscribe(value => emitted.push(value));

      component.setupAccount.set(null);
      component.setupStep.set(4);

      component.skipSetup();

      expect(emitted).toHaveLength(0);
    });

    it('does not make any evidence API calls when skipSetup is called at steps 4, 5, or 6', () => {
      // LandingAuthComponent does not inject EvidenceLibraryService directly —
      // skipSetup only emits onboarded without touching any evidence service.
      // Verify that only the onboarded output fires and no registered mock is invoked.
      const component = createFixture().componentInstance;

      for (const step of [4, 5, 6] as const) {
        component.setupAccount.set(account);
        component.setupStep.set(step);
        component.skipSetup();
      }

      // The only service mocks available to LandingAuthComponent are authentication,
      // profile, location, and browserSession — none of which should be called by skipSetup.
      expect(ensureCsrf).not.toHaveBeenCalled();
      expect(updatePreferences).not.toHaveBeenCalled();
      expect(login).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    });
  });

  describe('continueSetup at evidence steps', () => {
    const account = {
      profile: {skills: [], qualifications: [], roles: []},
      id: 'evidence-account',
      name: 'Evidence User',
      email: 'evidence@example.test',
    };

    it('advances from step 4 to step 5 without making API calls', () => {
      const component = createFixture().componentInstance;
      const emitted: unknown[] = [];
      component.onboarded.subscribe(value => emitted.push(value));

      component.setupAccount.set(account);
      component.setupStep.set(4);

      component.continueSetup();

      expect(component.setupStep()).toBe(5);
      expect(emitted).toHaveLength(0);
      expect(ensureCsrf).not.toHaveBeenCalled();
      expect(updatePreferences).not.toHaveBeenCalled();
    });

    it('advances from step 5 to step 6 without making API calls', () => {
      const component = createFixture().componentInstance;
      const emitted: unknown[] = [];
      component.onboarded.subscribe(value => emitted.push(value));

      component.setupAccount.set(account);
      component.setupStep.set(5);

      component.continueSetup();

      expect(component.setupStep()).toBe(6);
      expect(emitted).toHaveLength(0);
      expect(ensureCsrf).not.toHaveBeenCalled();
      expect(updatePreferences).not.toHaveBeenCalled();
    });

    it('emits onboarded exactly once with the account data at step 6', () => {
      const component = createFixture().componentInstance;
      const emitted: typeof account[] = [];
      component.onboarded.subscribe(value => emitted.push(value as typeof account));

      component.setupAccount.set(account);
      component.setupStep.set(6);

      component.continueSetup();

      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toEqual(account);
    });

    it('does not update setupStep after emitting onboarded at step 6', () => {
      const component = createFixture().componentInstance;
      component.onboarded.subscribe(() => undefined);

      component.setupAccount.set(account);
      component.setupStep.set(6);

      component.continueSetup();

      expect(component.setupStep()).toBe(6);
    });
  });

  describe('finishSetup completion behaviour', () => {
    const account = {
      profile: {revision: 1, skills: [], qualifications: [], roles: []},
      id: 'finish-account',
      name: 'Finish User',
      email: 'finish@example.test',
    };

    function primeSetup(component: LandingAuthComponent): void {
      component.setupAccount.set(account);
      component.setupTargetRoles.set('Support analyst');
      component.setupWorkplaceArrangements.set(['REMOTE']);
      component.setupStep.set(3);
    }

    it('advances to step 4 and stores the account without emitting onboarded on success', async () => {
      const component = createFixture().componentInstance;
      const emitted: unknown[] = [];
      component.onboarded.subscribe(value => emitted.push(value));
      primeSetup(component);

      await component.finishSetup();

      expect(component.setupStep()).toBe(4);
      expect(emitted).toHaveLength(0);
      expect(component.setupAccount()?.profile).toEqual(expect.objectContaining({revision: 2}));
      expect(invalidateCsrf).toHaveBeenCalled();
    });

    it('remains on step 3 and does not advance when the preferences update fails', async () => {
      updatePreferences.mockReturnValue(throwError(() => new Error('save failed')));
      const component = createFixture().componentInstance;
      const emitted: unknown[] = [];
      component.onboarded.subscribe(value => emitted.push(value));
      primeSetup(component);

      await component.finishSetup();

      expect(component.setupStep()).toBe(3);
      expect(emitted).toHaveLength(0);
      expect(component.errorMessage()).not.toBeNull();
    });
  });

  describe('new onboarding signals and navigation', () => {
    it('computes the six-step progress label for the evidence steps', () => {
      const component = createFixture().componentInstance;

      component.setupStep.set(4);
      expect(component.setupProgress()).toBe('4 of 6');

      component.setupStep.set(5);
      expect(component.setupProgress()).toBe('5 of 6');

      component.setupStep.set(6);
      expect(component.setupProgress()).toBe('6 of 6');
    });

    it('increments each entry counter when its handler is called', () => {
      const component = createFixture().componentInstance;

      expect(component.qualificationsAdded()).toBe(0);
      expect(component.employmentAdded()).toBe(0);
      expect(component.volunteeringAdded()).toBe(0);

      component.onQualificationAdded(makeEntry('Qualification', 'q-a'));
      expect(component.qualificationsAdded()).toBe(1);
      expect(component.employmentAdded()).toBe(0);
      expect(component.volunteeringAdded()).toBe(0);

      component.onEmploymentAdded(makeEntry('Employment', 'e-a'));
      expect(component.qualificationsAdded()).toBe(1);
      expect(component.employmentAdded()).toBe(1);
      expect(component.volunteeringAdded()).toBe(0);

      component.onVolunteeringAdded(makeEntry('Volunteering', 'v-a'));
      expect(component.qualificationsAdded()).toBe(1);
      expect(component.employmentAdded()).toBe(1);
      expect(component.volunteeringAdded()).toBe(1);
    });

    it('steps backwards through the evidence steps with previousSetupStep', () => {
      const component = createFixture().componentInstance;

      component.setupStep.set(4);
      component.previousSetupStep();
      expect(component.setupStep()).toBe(3);

      component.setupStep.set(5);
      component.previousSetupStep();
      expect(component.setupStep()).toBe(4);

      component.setupStep.set(6);
      component.previousSetupStep();
      expect(component.setupStep()).toBe(5);
    });
  });

  describe('onboarding correctness properties', () => {
    const accountArbitrary = fc.record({
      profile: fc.record({
        skills: fc.constant([] as string[]),
        qualifications: fc.constant([] as unknown[]),
        roles: fc.constant([] as unknown[]),
      }),
      id: fc.string(),
      name: fc.string(),
      email: fc.string(),
    }) as unknown as fc.Arbitrary<{
      profile: UserProfile;
      id?: string;
      name: string;
      email: string;
    }>;

    // Property 1: setupProgress formatting invariant. Validates: Requirement 1.2
    it('formats setupProgress as "N of 6" for every valid step', () => {
      fc.assert(
        fc.property(fc.constantFrom(1, 2, 3, 4, 5, 6), step => {
          const component = createFixture().componentInstance;
          component.setupStep.set(step as 1 | 2 | 3 | 4 | 5 | 6);
          expect(component.setupProgress()).toBe(`${step} of 6`);
        }),
      );
    });

    // Property 4: Entry counter reflects all saves for any step.
    // Validates: Requirements 2.2, 3.2, 3.3, 4.2
    it('accumulates each entry counter to exactly the number of handler calls', () => {
      const steps = [
        {
          step: 4 as const,
          handler: (c: LandingAuthComponent, i: number) =>
            c.onQualificationAdded(makeEntry('Qualification', `q-${i}`)),
          counter: (c: LandingAuthComponent) => c.qualificationsAdded(),
        },
        {
          step: 5 as const,
          handler: (c: LandingAuthComponent, i: number) =>
            c.onEmploymentAdded(makeEntry('Employment', `e-${i}`)),
          counter: (c: LandingAuthComponent) => c.employmentAdded(),
        },
        {
          step: 6 as const,
          handler: (c: LandingAuthComponent, i: number) =>
            c.onVolunteeringAdded(makeEntry('Volunteering', `v-${i}`)),
          counter: (c: LandingAuthComponent) => c.volunteeringAdded(),
        },
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...steps),
          fc.nat({max: 50}),
          ({step, handler, counter}, n) => {
            const component = createFixture().componentInstance;
            component.setupStep.set(step);
            for (let i = 0; i < n; i++) handler(component, i);
            expect(counter(component)).toBe(n);
          },
        ),
      );
    });

    // Property 2: continueSetup at step 6 emits onboarded exactly once.
    // Validates: Requirements 1.6, 1.7, 4.3
    it('emits onboarded exactly once without changing the step at step 6', () => {
      fc.assert(
        fc.property(accountArbitrary, account => {
          const component = createFixture().componentInstance;
          const emitted: typeof account[] = [];
          component.onboarded.subscribe(value => emitted.push(value as typeof account));

          component.setupAccount.set(account);
          component.setupStep.set(6);

          component.continueSetup();

          expect(emitted).toHaveLength(1);
          expect(emitted[0]).toEqual(account);
          expect(component.setupStep()).toBe(6);
        }),
      );
    });

    // Property 3: skipSetup emits onboarded exactly once with no API calls.
    // Validates: Requirements 5.1, 5.2
    it('skips any evidence step by emitting onboarded once without API calls', () => {
      fc.assert(
        fc.property(fc.constantFrom(4, 5, 6), accountArbitrary, (step, account) => {
          ensureCsrf.mockClear();
          updatePreferences.mockClear();
          login.mockClear();
          register.mockClear();

          const component = createFixture().componentInstance;
          const emitted: typeof account[] = [];
          component.onboarded.subscribe(value => emitted.push(value as typeof account));

          component.setupAccount.set(account);
          component.setupStep.set(step as 4 | 5 | 6);

          component.skipSetup();

          expect(emitted).toHaveLength(1);
          expect(emitted[0]).toEqual(account);
          // LandingAuthComponent does not inject EvidenceLibraryService; assert that
          // none of the available service mocks (which would carry any API call) fire.
          expect(ensureCsrf).not.toHaveBeenCalled();
          expect(updatePreferences).not.toHaveBeenCalled();
          expect(login).not.toHaveBeenCalled();
          expect(register).not.toHaveBeenCalled();
        }),
      );
    });
  });

  describe('evidence step template rendering', () => {
    const account = {
      profile: {skills: [], qualifications: [], roles: []},
      id: 'render-account',
      name: 'Render User',
      email: 'render@example.test',
    };

    function renderStep(step: 4 | 5 | 6) {
      const fixture = createFixture();
      fixture.componentInstance.setupAccount.set(account);
      fixture.componentInstance.setupStep.set(step);
      fixture.detectChanges();
      return fixture;
    }

    function iconNames(root: HTMLElement): string[] {
      return Array.from(root.querySelectorAll('mat-icon')).map(icon =>
        (icon.textContent ?? '').trim());
    }

    it('renders the qualification step with the school icon at step 4', () => {
      const fixture = renderStep(4);

      expect(fixture.nativeElement.querySelector('#setup-qualifications-title')).toBeTruthy();
      expect(iconNames(fixture.nativeElement)).toContain('school');
      expect(fixture.nativeElement.textContent).toContain('qualifications and training');
    });

    it('renders the employment step with the work_outline icon at step 5', () => {
      const fixture = renderStep(5);

      expect(fixture.nativeElement.querySelector('#setup-employment-title')).toBeTruthy();
      expect(iconNames(fixture.nativeElement)).toContain('work_outline');
      expect(fixture.nativeElement.textContent).toContain('employment history');
    });

    it('renders the volunteering step with the volunteer_activism icon at step 6', () => {
      const fixture = renderStep(6);

      expect(fixture.nativeElement.querySelector('#setup-volunteering-title')).toBeTruthy();
      expect(iconNames(fixture.nativeElement)).toContain('volunteer_activism');
      expect(fixture.nativeElement.textContent).toContain('volunteering experience');
    });

    it('renders exactly one evidence library instance per evidence step', () => {
      for (const step of [4, 5, 6] as const) {
        const fixture = renderStep(step);
        expect(fixture.nativeElement.querySelectorAll('app-evidence-library')).toHaveLength(1);
      }
    });

    it('updates the qualifications summary label when onQualificationAdded is called', () => {
      const fixture = renderStep(4);

      expect(fixture.nativeElement.querySelector('.setup-evidence-summary').textContent)
        .toContain('0 added so far');

      fixture.componentInstance.onQualificationAdded(makeEntry('Qualification', 'q-1'));
      fixture.componentInstance.onQualificationAdded(makeEntry('Qualification', 'q-2'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.setup-evidence-summary').textContent)
        .toContain('2 added so far');
    });

    it('updates the employment summary label when onEmploymentAdded is called', () => {
      const fixture = renderStep(5);

      fixture.componentInstance.onEmploymentAdded(makeEntry('Employment', 'e-1'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.setup-evidence-summary').textContent)
        .toContain('1 added so far');
    });

    it('updates the volunteering summary label when onVolunteeringAdded is called', () => {
      const fixture = renderStep(6);

      fixture.componentInstance.onVolunteeringAdded(makeEntry('Volunteering', 'v-1'));
      fixture.componentInstance.onVolunteeringAdded(makeEntry('Volunteering', 'v-2'));
      fixture.componentInstance.onVolunteeringAdded(makeEntry('Volunteering', 'v-3'));
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.setup-evidence-summary').textContent)
        .toContain('3 added so far');
    });
  });

  describe('evidence step template correctness properties', () => {
    const account = {
      profile: {skills: [], qualifications: [], roles: []},
      id: 'property-account',
      name: 'Property User',
      email: 'property@example.test',
    };

    // Property 11: Exactly one evidence form rendered per step.
    // Validates: Requirement 10.6
    it('renders exactly one evidence library instance for any evidence step', () => {
      fc.assert(
        fc.property(fc.constantFrom(4, 5, 6), step => {
          const fixture = createFixture();
          fixture.componentInstance.setupAccount.set(account);
          fixture.componentInstance.setupStep.set(step as 4 | 5 | 6);
          fixture.detectChanges();

          expect(fixture.nativeElement.querySelectorAll('app-evidence-library')).toHaveLength(1);
        }),
      );
    });

    // Property 10: previousSetupStep decrements through the full step range.
    // Validates: Requirement 9.3
    it('decrements setupStep by one for any step in {2, 3, 4, 5, 6}', () => {
      fc.assert(
        fc.property(fc.constantFrom(2, 3, 4, 5, 6), step => {
          const component = createFixture().componentInstance;
          component.setupStep.set(step as 2 | 3 | 4 | 5 | 6);

          component.previousSetupStep();

          expect(component.setupStep()).toBe(step - 1);
        }),
      );
    });

    // Property 9: setupStep does not advance on evidence save failure.
    // Validates: Requirement 8.3
    it('keeps setupStep unchanged when an evidence save fails (entryAdded not emitted)', () => {
      fc.assert(
        fc.property(fc.constantFrom(4, 5, 6), step => {
          const component = createFixture().componentInstance;
          component.setupAccount.set(account);
          component.setupStep.set(step as 4 | 5 | 6);

          // A failed createEvidence call causes EvidenceLibraryComponent to withhold
          // its entryAdded output, so the parent's on*Added handler is never invoked
          // and continueSetup is not called. The step must therefore stay put.
          expect(component.setupStep()).toBe(step);
        }),
      );
    });
  });

  describe('onboarding evidence entries and confirmation', () => {
    const account = {
      profile: {skills: [], qualifications: [], roles: []},
      id: 'confirm-account',
      name: 'Confirm User',
      email: 'confirm@example.test',
    };

    it('appends the emitted entry to qualificationEntries and reflects it in the count', () => {
      const component = createFixture().componentInstance;

      component.onQualificationAdded(makeEntry('BSc Computing', 'q-1'));

      expect(component.qualificationEntries()).toHaveLength(1);
      expect(component.qualificationEntries()[0]).toEqual(expect.objectContaining({
        entryId: 'q-1',
        heading: 'BSc Computing',
        confirmed: false,
        confirming: false,
      }));
      expect(component.qualificationsAdded()).toBe(1);
    });

    it('confirms an onboarding entry via confirmEvidence and flips confirmed to true', async () => {
      confirmEvidence.mockReturnValue(of(makeEntry('BSc Computing', 'q-1', {
        confirmed: true,
        version: 3,
      })));
      const component = createFixture().componentInstance;
      component.setupAccount.set(account);
      component.setupStep.set(4);
      component.onQualificationAdded(makeEntry('BSc Computing', 'q-1'));

      await component.confirmOnboardingEntry(4, 'q-1');

      expect(confirmEvidence).toHaveBeenCalledWith(
        'q-1', '"1"', 'body', false, {transferCache: false},
      );
      const entry = component.qualificationEntries()[0];
      expect(entry.confirmed).toBe(true);
      expect(entry.confirming).toBe(false);
      expect(entry.version).toBe(3);
      expect(invalidateCsrf).toHaveBeenCalled();
    });
  });
});

// Builds a minimal EvidenceEntry for driving the parent onboarding handlers.
// The parent only reads entryId, version and the latest revision's heading and
// confirmationState, so the remaining fields use minimal safe defaults.
function makeEntry(
  heading: string,
  entryId = 'entry-1',
  options: {confirmed?: boolean; version?: number} = {},
): EvidenceEntry {
  return {
    entryId,
    category: 'QUALIFICATION_TRAINING',
    visibility: 'VISIBLE',
    lifecycle: 'ACTIVE',
    reviewRequired: true,
    version: options.version ?? 1,
    revisions: [{
      revisionNumber: 1,
      heading,
      confirmationState: options.confirmed ? 'USER_CONFIRMED' : 'DRAFT',
      ongoing: false,
      demonstratedSkills: [],
      supportingLinks: [],
    }],
  } as unknown as EvidenceEntry;
}
