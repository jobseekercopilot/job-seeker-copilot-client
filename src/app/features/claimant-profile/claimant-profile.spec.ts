import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
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
    const updateProfile = vi.fn((profile: UserProfile) => {
      events.push('profile');
      return of<GatewayResponse>({statusCode: 200, success: true, user: {profile}});
    });
    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {provide: ProfileService, useValue: {updateProfile}},
        {provide: BrowserSessionService, useValue: {ensureCsrf, invalidateCsrf}},
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
});
