import {TestBed} from '@angular/core/testing';
import {of, throwError} from 'rxjs';
import type {GatewayResponse, UserProfile} from '../../api';
import {ProfileService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {LocationService} from '../../services/location.service';
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
        {provide: LocationService, useValue: {search: vi.fn(), getByPostcode: vi.fn()}},
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
        {provide: LocationService, useValue: {search: vi.fn(), getByPostcode: vi.fn()}},
      ],
    }).compileComponents();

    const component = TestBed.createComponent(ClaimantProfileComponent).componentInstance;
    component.startEditing();
    await component.save();

    expect(updateProfile).toHaveBeenCalledOnce();
    expect(handleAuthenticatedError).toHaveBeenCalledOnce();
    expect(handleAuthenticatedError).toHaveBeenCalledWith(expired);
  });
});
