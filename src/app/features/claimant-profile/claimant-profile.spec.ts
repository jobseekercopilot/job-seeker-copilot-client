import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import {of, Subject, throwError} from 'rxjs';
import type {GatewayResponse, UserProfile} from '../../api';
import {ProfileService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {idleLocationLookup, LocationService} from '../../services/location.service';
import {ClaimantProfileComponent} from './claimant-profile';

describe('ClaimantProfileComponent browser session', () => {
  it('bootstraps CSRF before a subject-bound profile update', async () => {
    const events: string[] = [];
    const ensureCsrf = vi.fn(() => {
      events.push('csrf');
      return of(undefined);
    });
    const invalidateCsrf = vi.fn();
    const handleAuthenticatedError = vi.fn();
    const updateProfile = vi.fn((profile: UserProfile) => {
      events.push('profile');
      return of<GatewayResponse>({statusCode: 200, success: true, user: {profile}});
    });
    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {provide: ProfileService, useValue: {updateProfile}},
        {provide: BrowserSessionService, useValue: {ensureCsrf, invalidateCsrf, handleAuthenticatedError}},
        {provide: LocationService, useValue: {lookup: () => of(idleLocationLookup)}},
      ],
    }).compileComponents();

    const component = TestBed.createComponent(ClaimantProfileComponent).componentInstance;
    component.startEditing();
    component.localSkills.set(['TypeScript']);
    await component.save();

    expect(events).toEqual(['csrf', 'profile']);
    expect(updateProfile).toHaveBeenCalledOnce();
    expect(invalidateCsrf).toHaveBeenCalledOnce();
  });

  it('reports a final profile 401 to the central session without replaying the write', async () => {
    const expired = {status: 401};
    const handleAuthenticatedError = vi.fn();
    const updateProfile = vi.fn(() => throwError(() => expired));
    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {provide: ProfileService, useValue: {updateProfile}},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf: () => of(undefined),
          invalidateCsrf: vi.fn(),
          handleAuthenticatedError,
        }},
        {provide: LocationService, useValue: {lookup: () => of(idleLocationLookup)}},
      ],
    }).compileComponents();

    const component = TestBed.createComponent(ClaimantProfileComponent).componentInstance;
    component.startEditing();
    await component.save();

    expect(updateProfile).toHaveBeenCalledOnce();
    expect(handleAuthenticatedError).toHaveBeenCalledOnce();
    expect(handleAuthenticatedError).toHaveBeenCalledWith(expired);
  });

  it('renders invalid guidance and clears metadata before a profile lookup', async () => {
    const lookup = vi.fn(() => of({
      status: 'invalid' as const,
      locations: [],
      message: 'Enter a valid UK location or postcode.',
    }));
    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {provide: ProfileService, useValue: {updateProfile: vi.fn()}},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf: () => of(undefined),
          invalidateCsrf: vi.fn(),
          handleAuthenticatedError: vi.fn(),
        }},
        {provide: LocationService, useValue: {lookup}},
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    const component = fixture.componentInstance;
    component.startEditing();
    component.localRegion.set('Old region');
    component.localAdminDistrict.set('Old district');
    component.localLatitude.set(1);
    component.localLongitude.set(2);

    component.onLocationInputChange('@@');
    fixture.detectChanges();

    expect(lookup).toHaveBeenCalledWith('@@');
    expect(component.localRegion()).toBe('');
    expect(component.localAdminDistrict()).toBe('');
    expect(component.localLatitude()).toBeUndefined();
    expect(component.localLongitude()).toBeUndefined();
    const status = fixture.nativeElement.querySelector('[data-testid="profile-location-status"]');
    expect(status.textContent).toContain('Enter a valid UK location or postcode.');
    expect(status.getAttribute('role')).toBe('alert');
  });

  it('stores canonical profile location fields and closes lookup feedback', async () => {
    const lookup = vi.fn(() => of(idleLocationLookup));
    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {provide: ProfileService, useValue: {updateProfile: vi.fn()}},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf: () => of(undefined),
          invalidateCsrf: vi.fn(),
          handleAuthenticatedError: vi.fn(),
        }},
        {provide: LocationService, useValue: {lookup}},
      ],
    }).compileComponents();
    const component = TestBed.createComponent(ClaimantProfileComponent).componentInstance;

    component.selectLocation({
      id: 'place-1',
      name: 'St Albans, Hertfordshire',
      postcode: 'AL1',
      region: 'East of England',
      latitude: 51.75,
      longitude: -0.34,
    });

    expect(component.localPostcode()).toBe('AL1');
    expect(component.localAdminDistrict()).toBe('St Albans');
    expect(component.localRegion()).toBe('East of England');
    expect(component.localLatitude()).toBe(51.75);
    expect(component.localLongitude()).toBe(-0.34);
    expect(component.locationLookup()).toEqual(idleLocationLookup);
    expect(lookup).toHaveBeenCalledWith('');
  });

  it('prevents duplicate profile updates and exposes progress while CSRF is pending', async () => {
    const csrf = new Subject<void>();
    const updateProfile = vi.fn((profile: UserProfile) =>
      of<GatewayResponse>({statusCode: 200, success: true, user: {profile}})
    );
    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {provide: ProfileService, useValue: {updateProfile}},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf: () => csrf,
          invalidateCsrf: vi.fn(),
          handleAuthenticatedError: vi.fn(),
        }},
        {provide: LocationService, useValue: {lookup: () => of(idleLocationLookup)}},
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    const component = fixture.componentInstance;
    component.startEditing();
    fixture.detectChanges();

    const first = component.save();
    await component.save();
    fixture.detectChanges();
    const saveButton = fixture.nativeElement.querySelector('#btn-save-inline') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Saving your profile. Please wait.');

    csrf.next();
    csrf.complete();
    await first;
    expect(updateProfile).toHaveBeenCalledOnce();
  });

  it('renders and focuses a safe profile-save failure alert', async () => {
    vi.useFakeTimers();
    try {
      await TestBed.configureTestingModule({
        imports: [ClaimantProfileComponent],
        providers: [
          {provide: ProfileService, useValue: {updateProfile: () => throwError(() => new Error('private upstream detail'))}},
          {provide: BrowserSessionService, useValue: {
            ensureCsrf: () => of(undefined),
            invalidateCsrf: vi.fn(),
            handleAuthenticatedError: vi.fn(),
          }},
          {provide: LocationService, useValue: {lookup: () => of(idleLocationLookup)}},
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(ClaimantProfileComponent);
      fixture.componentInstance.startEditing();

      await fixture.componentInstance.save();
      fixture.detectChanges();
      vi.runAllTimers();

      const alert = fixture.nativeElement.querySelector('#profile-save-error') as HTMLElement;
      expect(alert.getAttribute('role')).toBe('alert');
      expect(alert.textContent).toContain('could not be saved');
      expect(alert.textContent).not.toContain('private upstream detail');
      expect(document.activeElement).toBe(alert);
    } finally {
      vi.useRealTimers();
    }
  });

  it('has no detectable axe violations in profile read and edit modes', async () => {
    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {provide: ProfileService, useValue: {updateProfile: vi.fn()}},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf: () => of(undefined),
          invalidateCsrf: vi.fn(),
          handleAuthenticatedError: vi.fn(),
        }},
        {provide: LocationService, useValue: {lookup: () => of(idleLocationLookup)}},
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);

    fixture.componentInstance.startEditing();
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);
  });
});

async function expectNoAxeViolations(element: HTMLElement): Promise<void> {
  const result = await axe.run(element, {
    // jsdom has no layout engine, so contrast remains a browser/manual check.
    rules: {'color-contrast': {enabled: false}},
  });
  expect(result.violations.map(violation => ({
    id: violation.id,
    targets: violation.nodes.map(node => node.target),
  }))).toEqual([]);
}
