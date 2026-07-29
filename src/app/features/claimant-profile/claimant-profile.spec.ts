import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import {of, throwError} from 'rxjs';
import type {GatewayResponse, ProfilePreferencesUpdate, UserProfile} from '../../api';
import {ProfileService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {idleLocationLookup, LocationService} from '../../services/location.service';
import {ClaimantProfileComponent} from './claimant-profile';

describe('ClaimantProfileComponent progressive profile', () => {
  const updatePreferences = vi.fn();
  const ensureCsrf = vi.fn(() => of(undefined));
  const invalidateCsrf = vi.fn();
  const handleAuthenticatedError = vi.fn();
  const updateCurrentProfile = vi.fn();
  const lookup = vi.fn(() => of(idleLocationLookup));

  beforeEach(async () => {
    updatePreferences.mockReset();
    ensureCsrf.mockClear();
    invalidateCsrf.mockReset();
    handleAuthenticatedError.mockReset();
    updateCurrentProfile.mockReset();
    lookup.mockReset();
    lookup.mockReturnValue(of(idleLocationLookup));
    updatePreferences.mockImplementation((update: ProfilePreferencesUpdate) => of<GatewayResponse>({
      statusCode: 200,
      success: true,
      user: {
        profile: {
          revision: 4,
          skills: update.skills ?? [],
          qualifications: [],
          roles: [],
          aspirations: update.aspirations,
          workPreferences: update.workPreferences,
        },
      },
    }));

    await TestBed.configureTestingModule({
      imports: [ClaimantProfileComponent],
      providers: [
        {provide: ProfileService, useValue: {updatePreferences}},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf,
          invalidateCsrf,
          handleAuthenticatedError,
          updateCurrentProfile,
        }},
        {provide: LocationService, useValue: {lookup}},
      ],
    }).compileComponents();
  });

  it('updates preferences with revision awareness and no false defaults', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {
      revision: 3,
      skills: [],
      qualifications: [],
      roles: [],
    } satisfies UserProfile);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.startEditing('jobs');
    component.localTargetRoles.set(['Platform Engineer']);

    await component.saveSection();

    expect(updatePreferences).toHaveBeenCalledOnce();
    const [update, ifMatch] = updatePreferences.mock.calls[0];
    expect(ifMatch).toBe('"3"');
    expect(update.aspirations).toEqual({targetRoles: ['Platform Engineer']});
    expect(update.workPreferences).not.toHaveProperty('commuteRange');
    expect(update.workPreferences).not.toHaveProperty('availableFrom');
    expect(update.workPreferences).not.toHaveProperty('noticePeriodDays');
    expect(updateCurrentProfile).toHaveBeenCalledWith(expect.objectContaining({revision: 4}));
    expect(invalidateCsrf).toHaveBeenCalledOnce();
  });

  it('keeps profile areas optional and reports journey-specific readiness', () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {skills: [], qualifications: [], roles: []});
    fixture.detectChanges();

    expect(fixture.componentInstance.profileProgress()).toBe(0);
    expect(fixture.componentInstance.searchReady()).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('Add a target role or skill');
    expect(fixture.nativeElement.textContent).not.toContain('Documents need confirmed evidence');
    expect(fixture.nativeElement.textContent).not.toContain('Sign out');

    fixture.componentInstance.localTargetRoles.set(['Support analyst']);
    fixture.componentInstance.localWorkplaceArrangements.set(['REMOTE']);
    fixture.detectChanges();
    expect(fixture.componentInstance.searchReady()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Find jobs');
  });

  it('stores a selected location and clears stale derived metadata before lookup', () => {
    const component = TestBed.createComponent(ClaimantProfileComponent).componentInstance;
    component.selectLocation({
      id: 'place-1',
      name: 'Leeds, West Yorkshire',
      postcode: 'LS1',
      region: 'Yorkshire and the Humber',
      latitude: 53.8,
      longitude: -1.55,
    });
    expect(component.localAdminDistrict()).toBe('Leeds');
    expect(component.localPostcode()).toBe('LS1');

    component.onLocationInputChange('Bradford');
    expect(component.localRegion()).toBe('');
    expect(component.localAdminDistrict()).toBe('');
    expect(component.localLatitude()).toBeUndefined();
    expect(lookup).toHaveBeenCalledWith('Bradford');
  });

  it('shows a safe optimistic-concurrency message', async () => {
    updatePreferences.mockReturnValue(throwError(() => ({status: 409, detail: 'private'})));
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.componentRef.setInput('profile', {revision: 2, skills: []});
    fixture.detectChanges();
    fixture.componentInstance.startEditing('jobs');

    await fixture.componentInstance.saveSection();
    fixture.detectChanges();

    expect(fixture.componentInstance.saveError()).toContain('changed in another session');
    expect(fixture.nativeElement.textContent).not.toContain('private');
    expect(handleAuthenticatedError).toHaveBeenCalledWith(expect.objectContaining({status: 409}));
  });

  it('has no detectable axe violations in read and section-edit modes', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);
    fixture.componentInstance.startEditing('patterns');
    fixture.detectChanges();
    await expectNoAxeViolations(fixture.nativeElement);
  });
});

async function expectNoAxeViolations(element: HTMLElement): Promise<void> {
  const result = await axe.run(element, {
    rules: {'color-contrast': {enabled: false}},
  });
  expect(result.violations.map(violation => ({
    id: violation.id,
    targets: violation.nodes.map(node => node.target),
  }))).toEqual([]);
}
