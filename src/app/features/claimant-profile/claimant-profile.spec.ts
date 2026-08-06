import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import {of, Subject, throwError} from 'rxjs';
import type {
  EvidenceEntry,
  EvidenceRevision,
  GatewayResponse,
  ProfilePreferencesUpdate,
  UserProfile,
} from '../../api';
import {
  EvidenceEntryCategoryEnum,
  EvidenceLibraryService,
  EvidenceRevisionConfirmationStateEnum,
  ProfileService,
} from '../../api';
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
  const listEvidence = vi.fn();

  beforeEach(async () => {
    updatePreferences.mockReset();
    ensureCsrf.mockClear();
    invalidateCsrf.mockReset();
    handleAuthenticatedError.mockReset();
    updateCurrentProfile.mockReset();
    lookup.mockReset();
    lookup.mockReturnValue(of(idleLocationLookup));
    listEvidence.mockReset();
    listEvidence.mockReturnValue(of(evidenceEntries()));
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
        {provide: EvidenceLibraryService, useValue: {listEvidence}},
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

  it('uses professional section labels with unique accessible Edit controls', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    for (const label of [
      'Target roles',
      'Key skills',
      'Location and commute',
      'Working preferences',
      'Availability',
    ]) {
      expect(text).toContain(label);
      expect(fixture.nativeElement.querySelector(`[aria-label="Edit ${label}"]`)).not.toBeNull();
    }
    expect(text).not.toContain('What jobs are you looking for?');
    expect(text).not.toContain('Which skills should stand out?');
    expect(text).not.toContain('When can you start?');
  });

  it('shows a compact three-row active evidence summary and opens the manager', async () => {
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    const openManager = vi.fn();
    fixture.componentInstance.manageEvidenceRequested.subscribe(openManager);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelector(
      '[data-testid="profile-evidence-summary"]',
    ) as HTMLElement;
    expect(summary.querySelectorAll('.evidence-summary-row')).toHaveLength(3);
    expect(summary.textContent).toContain('Work experience');
    expect(summary.textContent).toContain('1 confirmed · 1 needs review');
    expect(summary.textContent).toContain('Qualifications');
    expect(summary.textContent).toContain('1 confirmed');
    expect(summary.textContent).toContain('Projects and achievements');
    expect(summary.textContent).toContain('No entries yet');

    (summary.querySelector('#manage-experience-evidence') as HTMLButtonElement).click();
    expect(openManager).toHaveBeenCalledOnce();
  });

  it('does not let a stale evidence response overwrite the current summary', async () => {
    const older = new Subject<EvidenceEntry[]>();
    const newer = new Subject<EvidenceEntry[]>();
    listEvidence.mockReturnValueOnce(older).mockReturnValueOnce(newer);
    const fixture = TestBed.createComponent(ClaimantProfileComponent);
    fixture.detectChanges();

    const refresh = fixture.componentInstance.refreshEvidenceSummary();
    newer.next([evidenceEntries()[2]]);
    newer.complete();
    await refresh;
    older.next(evidenceEntries());
    older.complete();
    await fixture.whenStable();

    expect(fixture.componentInstance.evidenceEntries()).toHaveLength(1);
    expect(fixture.componentInstance.evidenceSummary(
      fixture.componentInstance.evidenceSummaryRows[1],
    )).toBe('1 confirmed');
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

function evidenceEntries(): EvidenceEntry[] {
  return [
    evidenceEntry(
      EvidenceEntryCategoryEnum.Employment,
      EvidenceRevisionConfirmationStateEnum.UserConfirmed,
      false,
      'employment-confirmed',
    ),
    evidenceEntry(
      EvidenceEntryCategoryEnum.Freelance,
      EvidenceRevisionConfirmationStateEnum.UserConfirmed,
      true,
      'freelance-review',
    ),
    evidenceEntry(
      EvidenceEntryCategoryEnum.QualificationTraining,
      EvidenceRevisionConfirmationStateEnum.UserConfirmed,
      false,
      'qualification',
    ),
    {
      ...evidenceEntry(
        EvidenceEntryCategoryEnum.Project,
        EvidenceRevisionConfirmationStateEnum.UserConfirmed,
        false,
        'archived-project',
      ),
      lifecycle: 'ARCHIVED',
    } as EvidenceEntry,
  ];
}

function evidenceEntry(
  category: EvidenceEntry['category'],
  confirmationState: EvidenceRevision['confirmationState'],
  reviewRequired: boolean,
  id: string,
): EvidenceEntry {
  return {
    entryId: id,
    category,
    lifecycle: 'ACTIVE',
    visibility: 'VISIBLE',
    reviewRequired,
    version: 1,
    revisions: [{
      revisionId: `${id}-revision`,
      revisionNumber: 1,
      confirmationState,
      contentDigest: 'digest',
      heading: id,
      ongoing: false,
      demonstratedSkills: [],
      supportingLinks: [],
      facts: [],
      createdAt: '2026-07-29T00:00:00Z',
      createdBy: 'USER',
    } as EvidenceRevision],
  } as EvidenceEntry;
}
