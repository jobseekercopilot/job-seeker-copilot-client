import {TestBed} from '@angular/core/testing';
import axe from 'axe-core';
import {of, throwError} from 'rxjs';
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
