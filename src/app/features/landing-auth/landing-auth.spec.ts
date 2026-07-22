import {TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';
import type {UserProfile} from '../../api';
import {AuthenticationService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {LocationService} from '../../services/location.service';
import {LandingAuthComponent} from './landing-auth';

describe('LandingAuthComponent browser session', () => {
  const events: string[] = [];
  const login = vi.fn();
  const register = vi.fn();
  const ensureCsrf = vi.fn();
  const invalidateCsrf = vi.fn();
  const acceptAuthenticatedUser = vi.fn();

  beforeEach(async () => {
    events.length = 0;
    login.mockReset();
    register.mockReset();
    ensureCsrf.mockReset();
    invalidateCsrf.mockReset();
    acceptAuthenticatedUser.mockReset();
    ensureCsrf.mockImplementation(() => {
      events.push('csrf');
      return of(undefined);
    });
    login.mockImplementation(() => {
      events.push('login');
      return of({
        statusCode: 200,
        success: true,
        user: {id: 'account-id', name: 'Beta User', email: 'beta@example.test', profile: {skills: ['TypeScript']}},
      });
    });

    await TestBed.configureTestingModule({
      imports: [LandingAuthComponent],
      providers: [
        {provide: AuthenticationService, useValue: {login, register}},
        {provide: BrowserSessionService, useValue: {ensureCsrf, invalidateCsrf, acceptAuthenticatedUser}},
        {provide: LocationService, useValue: {search: vi.fn(), getByPostcode: vi.fn()}},
      ],
    }).compileComponents();
  });

  it('bootstraps CSRF before login and emits no token or identity selector', async () => {
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
    let onboarded: {profile: UserProfile; name: string; email: string} | undefined;
    component.onboarded.subscribe(value => onboarded = value);
    component.loginEmail.set('BETA@EXAMPLE.TEST');
    component.loginPassword.set('safe-password');

    await component.submitLogin();

    expect(events).toEqual(['csrf', 'login']);
    expect(invalidateCsrf).toHaveBeenCalledOnce();
    expect(acceptAuthenticatedUser).toHaveBeenCalledWith(expect.objectContaining({
      email: 'beta@example.test',
      profile: expect.objectContaining({skills: ['TypeScript']}),
    }));
    expect(login).toHaveBeenCalledWith({email: 'beta@example.test', password: 'safe-password'});
    expect(onboarded).toEqual({
      profile: expect.objectContaining({skills: ['TypeScript']}),
      name: 'Beta User',
      email: 'beta@example.test',
    });
    expect(onboarded).not.toHaveProperty('token');
    expect(onboarded).not.toHaveProperty('userId');
  });

  it('fails closed without CSRF and never sends credentials to login', async () => {
    ensureCsrf.mockReturnValue(throwError(() => new Error('invalid CSRF bootstrap')));
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
    component.loginEmail.set('beta@example.test');
    component.loginPassword.set('safe-password');

    await component.submitLogin();

    expect(login).not.toHaveBeenCalled();
    expect(invalidateCsrf).not.toHaveBeenCalled();
    expect(component.errorMessage()).toBe('Unable to contact the authentication service.');
  });

  it('seeds the central token-free session after registration', async () => {
    register.mockImplementation(() => {
      events.push('register');
      return of({
        statusCode: 201,
        success: true,
        user: {id: 'new-account', name: 'New User', email: 'new@example.test', profile: {skills: ['TypeScript']}},
      });
    });
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;
    component.formName.set('New User');
    component.formEmail.set('new@example.test');
    component.formPassword.set('safe-password');
    component.localSkills.set(['TypeScript']);
    component.localTargetRoles.set(['Software Developer']);
    component.localPostcode.set('SW1A 1AA');
    component.currentStep.set(3);

    await component.completeRegistration();

    expect(events).toEqual(['csrf', 'register']);
    expect(acceptAuthenticatedUser).toHaveBeenCalledWith(expect.objectContaining({
      id: 'new-account',
      email: 'new@example.test',
      profile: expect.objectContaining({skills: ['TypeScript']}),
    }));
  });
});
