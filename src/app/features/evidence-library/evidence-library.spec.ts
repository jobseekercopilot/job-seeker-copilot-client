import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import {of, Subject, throwError} from 'rxjs';
import type {EvidenceEntry, EvidenceRevision} from '../../api';
import {EvidenceLibraryService} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';
import {EvidenceLibraryComponent} from './evidence-library';

describe('EvidenceLibraryComponent', () => {
  const listEvidence = vi.fn();
  const createEvidence = vi.fn();
  const updateEvidence = vi.fn();
  const confirmEvidence = vi.fn();
  const archiveEvidence = vi.fn();
  const restoreEvidence = vi.fn();
  const hideEvidence = vi.fn();
  const showEvidence = vi.fn();
  const supersedeEvidence = vi.fn();
  const ensureCsrf = vi.fn(() => of(undefined));
  const invalidateCsrf = vi.fn();
  const handleAuthenticatedError = vi.fn();

  beforeEach(async () => {
    for (const mock of [
      listEvidence, createEvidence, updateEvidence, confirmEvidence,
      archiveEvidence, restoreEvidence, hideEvidence, showEvidence,
      supersedeEvidence,
      invalidateCsrf, handleAuthenticatedError,
    ]) mock.mockReset();
    ensureCsrf.mockClear();
    listEvidence.mockReturnValue(of([entry()]));
    createEvidence.mockReturnValue(of(entry()));
    updateEvidence.mockReturnValue(of(entry()));
    confirmEvidence.mockReturnValue(of(entry({confirmed: true})));
    archiveEvidence.mockReturnValue(of(entry({lifecycle: 'ARCHIVED'})));
    restoreEvidence.mockReturnValue(of(entry()));
    hideEvidence.mockReturnValue(of(entry()));
    showEvidence.mockReturnValue(of(entry()));
    supersedeEvidence.mockReturnValue(of(entry({lifecycle: 'SUPERSEDED'})));

    await TestBed.configureTestingModule({
      imports: [EvidenceLibraryComponent],
      providers: [
        {provide: EvidenceLibraryService, useValue: {
          listEvidence,
          createEvidence,
          updateEvidence,
          confirmEvidence,
          archiveEvidence,
          restoreEvidence,
          hideEvidence,
          showEvidence,
          supersedeEvidence,
        }},
        {provide: BrowserSessionService, useValue: {
          ensureCsrf,
          invalidateCsrf,
          handleAuthenticatedError,
        }},
      ],
    }).compileComponents();
  });

  it('shows migrated drafts as review-required without implying verification', async () => {
    const fixture = TestBed.createComponent(EvidenceLibraryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('We moved your existing work history');
    expect(fixture.nativeElement.textContent).toContain('Migrated item');
    expect(fixture.nativeElement.textContent).toContain('not independently verified');
    expect(listEvidence).toHaveBeenCalledWith(false, 'body', false, {transferCache: false});

    (fixture.nativeElement.querySelector('.card-action') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Revision history');
    expect(fixture.nativeElement.textContent).toContain('Revision 1');
  });

  it('creates a category-aware draft through the generated client', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    component.openCreate();
    component.category.set('PROJECT');
    component.heading.set('Public service redesign');
    component.projectRole.set('Delivery lead');
    component.description.set('Redesigned a bounded public service workflow.');
    component.demonstratedSkills.set('Discovery, Delivery');
    component.supportingLinks.set('https://example.test/project');

    await component.saveDraft();

    expect(createEvidence).toHaveBeenCalledWith(expect.objectContaining({
      category: 'PROJECT',
      heading: 'Public service redesign',
      projectRole: 'Delivery lead',
      demonstratedSkills: ['Discovery', 'Delivery'],
      supportingLinks: ['https://example.test/project'],
    }), 'body', false, {transferCache: false});
    expect(invalidateCsrf).toHaveBeenCalledOnce();
  });

  it('edits as a new draft, confirms, and requires a second archive action', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    const current = entry();
    component.openEdit(current);
    component.achievements.set('Improved completion by 10%.');
    await component.saveDraft();
    expect(updateEvidence).toHaveBeenCalledWith(
      current.entryId, expect.objectContaining({achievements: 'Improved completion by 10%.'}),
      '"2"', 'body', false, {transferCache: false});

    await component.perform(current, 'confirm');
    expect(confirmEvidence).toHaveBeenCalledWith(current.entryId, '"2"');

    await component.perform(current, 'archive');
    expect(archiveEvidence).not.toHaveBeenCalled();
    expect(component.pendingArchive()).toBe(current);
    await component.confirmArchive();
    expect(archiveEvidence).toHaveBeenCalledWith(current.entryId, '"2"');
  });

  it('reloads archived evidence explicitly and reports optimistic conflicts safely', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    component.toggleArchived();
    expect(listEvidence).toHaveBeenCalledWith(true, 'body', false, {transferCache: false});

    updateEvidence.mockReturnValue(throwError(() => ({status: 409, body: 'private'})));
    component.openEdit(entry());
    await component.saveDraft();
    expect(component.error()).toContain('changed in another session');
    expect(component.error()).not.toContain('private');
  });

  it('shows evidence details and confirms superseding against a selected replacement', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    const older = entry();
    const replacement = {
      ...entry(),
      entryId: '33333333-3333-3333-3333-333333333333',
      reviewRequired: false,
    };
    component.entries.set([older, replacement]);

    component.toggleView(older);
    expect(component.viewingEntryId()).toBe(older.entryId);
    component.openSupersede(older);
    component.replacementEntryId.set(replacement.entryId);
    await component.confirmSupersede();

    expect(supersedeEvidence).toHaveBeenCalledWith(
      older.entryId,
      {replacementEntryId: replacement.entryId},
      '"2"',
    );
  });

  it('removes an employment end date when Current is selected and omits it from the payload', async () => {
    const fixture = TestBed.createComponent(EvidenceLibraryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.openCreate();
    component.roleTitle.set('Software developer');
    component.organisationContext.set('Example Ltd');
    component.startDate.set('2024-02-01');
    component.endDate.set('2026-07-01');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('input[name="endDate"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="heading"]')).toBeNull();

    component.setOngoing(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('input[name="endDate"]')).toBeNull();
    expect(component.endDate()).toBe('');
    expect(fixture.nativeElement.textContent).toContain('end date was removed');

    await component.saveDraft();
    const request = createEvidence.mock.calls.at(-1)?.[0];
    expect(request).toEqual(expect.objectContaining({
      category: 'EMPLOYMENT',
      heading: 'Software developer',
      ongoing: true,
    }));
    expect(request).not.toHaveProperty('endDate');
  });

  it('saves exactly the status-specific education date without an ongoing flag', async () => {
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    component.openCreate();
    component.changeCategory('EDUCATION');
    component.programmeOrSubject.set('BSc Computing');
    component.institution.set('Example University');
    component.issueDate.set('2025-06-01');

    await component.saveDraft();
    let request = createEvidence.mock.calls.at(-1)?.[0];
    expect(request).toEqual(expect.objectContaining({
      heading: 'BSc Computing',
      resultOrStatus: 'Completed',
      issueDate: {precision: 'DAY', year: 2025, month: 6, day: 1},
    }));
    expect(request).not.toHaveProperty('endDate');
    expect(request).not.toHaveProperty('ongoing');

    component.openCreate();
    component.changeCategory('EDUCATION');
    component.programmeOrSubject.set('MSc Computing');
    component.institution.set('Example University');
    component.setCompletionStatus('In progress');
    component.endDate.set('2027-09-01');
    await component.saveDraft();

    request = createEvidence.mock.calls.at(-1)?.[0];
    expect(request).toEqual(expect.objectContaining({
      resultOrStatus: 'In progress',
      endDate: {precision: 'DAY', year: 2027, month: 9, day: 1},
    }));
    expect(request).not.toHaveProperty('issueDate');
    expect(request).not.toHaveProperty('ongoing');
  });

  it('preserves partial-date precision and a private qualification identifier while details are collapsed', async () => {
    const current = entry();
    const revision = current.revisions[0];
    const qualification = {
      ...current,
      category: 'QUALIFICATION_TRAINING',
      revisions: [{
        ...revision,
        heading: 'AWS Cloud Practitioner',
        roleTitle: undefined,
        organisationContext: undefined,
        qualificationTitle: 'AWS Cloud Practitioner',
        issuer: 'AWS',
        resultOrStatus: 'Completed',
        issueDate: {precision: 'YEAR', year: 2025},
        startDate: undefined,
        endDate: undefined,
        privateCredentialIdentifier: 'private-credential-123',
      }],
    } as EvidenceEntry;
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;

    component.openEdit(qualification);
    expect(component.advancedExpanded()).toBe(false);
    await component.saveDraft();

    expect(updateEvidence).toHaveBeenCalledWith(
      qualification.entryId,
      expect.objectContaining({
        heading: 'AWS Cloud Practitioner',
        issueDate: {precision: 'YEAR', year: 2025},
        privateCredentialIdentifier: 'private-credential-123',
      }),
      '"2"',
      'body',
      false,
      {transferCache: false},
    );
  });

  it('accepts freelance evidence without a client and never offers or sends a career-break reason', async () => {
    const fixture = TestBed.createComponent(EvidenceLibraryComponent);
    const component = fixture.componentInstance;
    component.openCreate();
    component.changeCategory('FREELANCE');
    component.roleTitle.set('Accessibility review');
    component.description.set('Reviewed a public website against WCAG.');
    component.qualificationTitle.set('Unrelated hidden value');
    await component.saveDraft();

    const freelanceRequest = createEvidence.mock.calls.at(-1)?.[0];
    expect(freelanceRequest).toEqual(expect.objectContaining({
      category: 'FREELANCE',
      heading: 'Accessibility review',
    }));
    expect(freelanceRequest.organisationContext).toBeUndefined();
    expect(freelanceRequest).not.toHaveProperty('qualificationTitle');

    component.openCreate();
    component.changeCategory('CAREER_BREAK');
    component.heading.set('Career break');
    component.description.set('Optional neutral context.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Reason');
    await component.saveDraft();
    expect(createEvidence.mock.calls.at(-1)?.[0]).not.toHaveProperty('careerBreakReason');
  });

  it('ignores a late evidence-list response and emits changes after successful mutations', async () => {
    const older = new Subject<EvidenceEntry[]>();
    const newer = new Subject<EvidenceEntry[]>();
    listEvidence.mockReturnValueOnce(older).mockReturnValueOnce(newer);
    const component = TestBed.createComponent(EvidenceLibraryComponent).componentInstance;
    const changed = vi.fn();
    component.changed.subscribe(changed);

    const firstLoad = component.load();
    const secondLoad = component.load();
    const replacement = {...entry(), entryId: '44444444-4444-4444-4444-444444444444'};
    newer.next([replacement]);
    newer.complete();
    await secondLoad;
    older.next([entry()]);
    older.complete();
    await firstLoad;

    expect(component.entries().map(candidate => candidate.entryId)).toEqual([
      replacement.entryId,
    ]);
    await component.perform(replacement, 'confirm');
    expect(changed).toHaveBeenCalledOnce();
  });

  it('has no detectable axe violations', async () => {
    const fixture = TestBed.createComponent(EvidenceLibraryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const result = await axe.run(fixture.nativeElement, {
      rules: {'color-contrast': {enabled: false}},
    });
    expect(result.violations.map(violation => violation.id)).toEqual([]);
  });
});

function entry(options: {
  confirmed?: boolean;
  lifecycle?: 'ACTIVE' | 'ARCHIVED' | 'SUPERSEDED';
} = {}): EvidenceEntry {
  const revision = {
    revisionId: '22222222-2222-2222-2222-222222222222',
    revisionNumber: 1,
    confirmationState: options.confirmed ? 'USER_CONFIRMED' : 'DRAFT',
    contentDigest: 'digest',
    heading: 'Migrated adviser role',
    organisationContext: 'Example council',
    roleTitle: 'Adviser',
    ongoing: false,
    startDate: {precision: 'MONTH', year: 2022, month: 3},
    endDate: {precision: 'YEAR', year: 2025},
    demonstratedSkills: ['Customer service'],
    supportingLinks: [],
    facts: [],
    createdAt: '2026-07-29T00:00:00Z',
    createdBy: 'LEGACY_MIGRATION',
  } as EvidenceRevision;
  return {
    entryId: '11111111-1111-1111-1111-111111111111',
    category: 'EMPLOYMENT',
    visibility: 'VISIBLE',
    lifecycle: options.lifecycle ?? 'ACTIVE',
    reviewRequired: !options.confirmed,
    version: 2,
    revisions: [revision],
  } as EvidenceEntry;
}
