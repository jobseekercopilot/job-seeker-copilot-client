import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import {of, throwError} from 'rxjs';
import type {UserProfile} from '../../api';
import {AuthenticationService, ProfileService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {registrationPasswordError, unicodeCodePointLength} from './credential-policy';
import {LandingAuthComponent} from './landing-auth';

describe('LandingAuthComponent credential-only registration', () => {
  const events: string[] = [];
  const login = vi.fn();
  const register = vi.fn();
  const ensureCsrf = vi.fn();
  const invalidateCsrf = vi.fn();
  const acceptAuthenticatedUser = vi.fn();
  const handleAuthenticatedError = vi.fn();
  const updatePreferences = vi.fn();

  beforeEach(async () => {
    events.length = 0;
    login.mockReset();
    register.mockReset();
    ensureCsrf.mockReset();
    invalidateCsrf.mockReset();
    acceptAuthenticatedUser.mockReset();
    handleAuthenticatedError.mockReset();
    updatePreferences.mockReset();
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
        {provide: AuthenticationService, useValue: {login, register}},
        {provide: ProfileService, useValue: {updatePreferences}},
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
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
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

    await component.completeRegistration();

    expect(events).toEqual(['csrf', 'register']);
    expect(register).toHaveBeenCalledWith({
      name: 'New User',
      email: 'new@example.test',
      password: 'safe-password-value',
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
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
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
    await component.completeRegistration();

    component.setupTargetRoles.set('Support analyst');
    component.continueSetup();
    component.setupPostcode.set('LS1 1AA');
    component.continueSetup();
    component.toggleWorkplace('REMOTE');
    component.continueSetup();
    component.setupSkills.set('Customer service');
    await component.finishSetup();

    expect(updatePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: ['Customer service'],
        aspirations: {targetRoles: ['Support analyst']},
        workPreferences: expect.objectContaining({
          location: {postcode: 'LS1 1AA'},
          workplaceArrangements: ['REMOTE'],
        }),
      }),
      '"1"',
      'body',
      false,
      {transferCache: false},
    );
    expect(onboarded?.profile).toEqual(expect.objectContaining({revision: 2}));
  });

  it('does not advance past search location without an explicit postcode', () => {
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
    component.setupStep.set(2);

    component.continueSetup();

    expect(component.setupStep()).toBe(2);
    expect(component.errorMessage()).toBe(
      'Add a postcode before continuing, or set this up later.',
    );
  });

  it('bootstraps CSRF before login and preserves password whitespace', async () => {
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
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
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
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
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
    component.formName.set('New User');
    component.formEmail.set('new@example.test');
    component.formPassword.set('🌱'.repeat(14));

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
      const fixture = TestBed.createComponent(LandingAuthComponent);
      fixture.detectChanges();
      const createTab = fixture.nativeElement.querySelector('#tab-btn-create') as HTMLButtonElement;
      createTab.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
      fixture.detectChanges();
      vi.runAllTimers();

      const signInTab = fixture.nativeElement.querySelector('#tab-btn-signin') as HTMLButtonElement;
      expect(signInTab.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(signInTab);
      expect(fixture.nativeElement.querySelector('#login-password').autocomplete).toBe('current-password');

      fixture.componentInstance.setMode('create');
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
    const fixture = TestBed.createComponent(LandingAuthComponent);
    fixture.detectChanges();
    expect((await axe.run(fixture.nativeElement)).violations).toEqual([]);
    fixture.componentInstance.setMode('signin');
    fixture.detectChanges();
    expect((await axe.run(fixture.nativeElement)).violations).toEqual([]);
  });
});
