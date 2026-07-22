import {TestBed} from '@angular/core/testing';
import {of, Subject, throwError} from 'rxjs';
import type {UserProfile} from '../../api';
import {AuthenticationService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {
  idleLocationLookup,
  LocationService,
  type LocationLookupState,
} from '../../services/location.service';
import {LandingAuthComponent} from './landing-auth';

describe('LandingAuthComponent browser session', () => {
  const events: string[] = [];
  const login = vi.fn();
  const register = vi.fn();
  const ensureCsrf = vi.fn();
  const invalidateCsrf = vi.fn();
  const acceptAuthenticatedUser = vi.fn();
  const lookup = vi.fn();

  beforeEach(async () => {
    events.length = 0;
    login.mockReset();
    register.mockReset();
    ensureCsrf.mockReset();
    invalidateCsrf.mockReset();
    acceptAuthenticatedUser.mockReset();
    lookup.mockReset();
    lookup.mockReturnValue(of(idleLocationLookup));
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
        {provide: LocationService, useValue: {lookup}},
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

  it('ignores a stale location response and renders the latest result', () => {
    const stale = new Subject<LocationLookupState>();
    const latest = new Subject<LocationLookupState>();
    lookup.mockReturnValueOnce(stale).mockReturnValueOnce(latest);
    const fixture = TestBed.createComponent(LandingAuthComponent);
    const component = fixture.componentInstance;
    component.currentStep.set(3);

    component.onLocationInputChange('Le');
    component.onLocationInputChange('Leeds');
    stale.next({
      status: 'results',
      locations: [{id: 'stale', name: 'Leicester', postcode: 'LE1'}],
      message: '1 matching location found.',
    });
    latest.next({
      status: 'results',
      locations: [{id: 'latest', name: 'Leeds', postcode: 'LS1'}],
      message: '1 matching location found.',
    });
    fixture.detectChanges();

    expect(lookup).toHaveBeenNthCalledWith(1, 'Le');
    expect(lookup).toHaveBeenNthCalledWith(2, 'Leeds');
    expect(component.locationSuggestions()).toEqual([
      expect.objectContaining({id: 'latest', name: 'Leeds'}),
    ]);
    expect(fixture.nativeElement.textContent).toContain('Leeds');
    expect(fixture.nativeElement.textContent).not.toContain('Leicester');
  });

  it('clears selected metadata on edit and renders safe provider failure guidance', () => {
    lookup.mockReturnValue(of({
      status: 'unavailable',
      locations: [],
      message: 'Location search is temporarily unavailable. Try again.',
    }));
    const fixture = TestBed.createComponent(LandingAuthComponent);
    const component = fixture.componentInstance;
    component.currentStep.set(3);
    component.localRegion.set('Old region');
    component.localAdminDistrict.set('Old district');
    component.localLatitude.set(1);
    component.localLongitude.set(2);

    component.onLocationInputChange('Private place');
    fixture.detectChanges();

    expect(component.localRegion()).toBe('');
    expect(component.localAdminDistrict()).toBe('');
    expect(component.localLatitude()).toBeUndefined();
    expect(component.localLongitude()).toBeUndefined();
    const status = fixture.nativeElement.querySelector('[data-testid="registration-location-status"]');
    expect(status.textContent).toContain('temporarily unavailable');
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.textContent).not.toContain('Private place');
  });

  it('stores canonical selected location fields without a second request', () => {
    const component = TestBed.createComponent(LandingAuthComponent).componentInstance;

    component.selectLocation({
      id: 'place-1',
      name: 'Leeds, West Yorkshire',
      postcode: 'LS1',
      region: 'Yorkshire and the Humber',
      latitude: 53.8,
      longitude: -1.55,
    });

    expect(component.localPostcode()).toBe('LS1');
    expect(component.localAdminDistrict()).toBe('Leeds');
    expect(component.localRegion()).toBe('Yorkshire and the Humber');
    expect(component.localLatitude()).toBe(53.8);
    expect(component.localLongitude()).toBe(-1.55);
    expect(lookup).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledWith('');
  });
});
