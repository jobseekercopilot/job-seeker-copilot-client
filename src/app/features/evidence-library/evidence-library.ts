import {CommonModule} from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  output,
  signal,
} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {firstValueFrom} from 'rxjs';
import {
  EvidenceEntryCategoryEnum,
  EvidenceEntryLifecycleEnum,
  EvidenceLibraryService,
  EvidenceRevisionConfirmationStateEnum,
  EvidenceWriteRequestCategoryEnum,
  PartialDatePrecisionEnum,
} from '../../api';
import type {
  EvidenceEntry,
  EvidenceRevision,
  EvidenceWriteRequest,
  PartialDate,
} from '../../api';
import {BrowserSessionService} from '../../services/browser-session.service';

type EditorMode = 'create' | 'edit';
type EvidenceAction = 'confirm' | 'archive' | 'restore' | 'hide' | 'show';

@Component({
  selector: 'app-evidence-library',
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './evidence-library.html',
  styleUrl: './evidence-library.css',
})
export class EvidenceLibraryComponent implements OnInit {
  private readonly api = inject(EvidenceLibraryService);
  private readonly browserSession = inject(BrowserSessionService);

  readonly notify = output<{message: string; type: 'success' | 'info' | 'error'}>();
  readonly entries = signal<EvidenceEntry[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly includeArchived = signal(false);
  readonly categoryFilter = signal('ALL');
  readonly stateFilter = signal('ALL');
  readonly editorMode = signal<EditorMode | null>(null);
  readonly editingEntry = signal<EvidenceEntry | null>(null);
  readonly pendingArchive = signal<EvidenceEntry | null>(null);
  readonly pendingSupersede = signal<EvidenceEntry | null>(null);
  readonly replacementEntryId = signal('');
  readonly viewingEntryId = signal<string | null>(null);

  readonly category = signal<string>('EMPLOYMENT');
  readonly heading = signal('');
  readonly organisationContext = signal('');
  readonly roleTitle = signal('');
  readonly programmeOrSubject = signal('');
  readonly institution = signal('');
  readonly qualificationTitle = signal('');
  readonly issuer = signal('');
  readonly resultOrStatus = signal('');
  readonly projectRole = signal('');
  readonly description = signal('');
  readonly responsibilities = signal('');
  readonly achievements = signal('');
  readonly careerBreakReason = signal('');
  readonly ongoing = signal(false);
  readonly startDate = signal('');
  readonly endDate = signal('');
  readonly issueDate = signal('');
  readonly expiryDate = signal('');
  readonly demonstratedSkills = signal('');
  readonly supportingLinks = signal('');

  readonly categories = [
    ['EMPLOYMENT', 'Employment'],
    ['EDUCATION', 'Education'],
    ['QUALIFICATION_TRAINING', 'Qualifications / training'],
    ['PROJECT', 'Projects'],
    ['VOLUNTEERING', 'Volunteering'],
    ['FREELANCE', 'Freelance'],
    ['ACHIEVEMENT', 'Achievements'],
    ['CAREER_BREAK', 'Career breaks'],
    ['OTHER', 'Other'],
  ] as const;

  readonly migratedReviewCount = computed(() =>
    this.entries().filter(entry => entry.reviewRequired).length);
  readonly replacementEntries = computed(() => this.entries().filter(entry =>
    entry.lifecycle === EvidenceEntryLifecycleEnum.Active
    && entry.entryId !== this.pendingSupersede()?.entryId));
  readonly filteredEntries = computed(() => this.entries().filter(entry => {
    if (this.categoryFilter() !== 'ALL' && entry.category !== this.categoryFilter()) return false;
    const latest = this.latest(entry);
    if (this.stateFilter() === 'DRAFT'
      && latest?.confirmationState !== EvidenceRevisionConfirmationStateEnum.Draft) return false;
    if (this.stateFilter() === 'CONFIRMED'
      && latest?.confirmationState !== EvidenceRevisionConfirmationStateEnum.UserConfirmed) return false;
    if (this.stateFilter() === 'ARCHIVED'
      && entry.lifecycle !== EvidenceEntryLifecycleEnum.Archived) return false;
    return true;
  }));

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.entries.set(await firstValueFrom(
        this.api.listEvidence(this.includeArchived(), 'body', false, {transferCache: false}),
      ));
    } catch (error) {
      this.browserSession.handleAuthenticatedError(error);
      this.error.set('Your experience and achievements could not be loaded. Try again.');
    } finally {
      this.loading.set(false);
    }
  }

  toggleArchived(): void {
    this.includeArchived.update(value => !value);
    void this.load();
  }

  openCreate(): void {
    this.resetForm();
    this.editorMode.set('create');
    this.editingEntry.set(null);
    this.error.set(null);
  }

  openEdit(entry: EvidenceEntry): void {
    const revision = this.latest(entry);
    if (!revision) return;
    this.category.set(entry.category);
    this.heading.set(revision.heading);
    this.organisationContext.set(revision.organisationContext ?? '');
    this.roleTitle.set(revision.roleTitle ?? '');
    this.programmeOrSubject.set(revision.programmeOrSubject ?? '');
    this.institution.set(revision.institution ?? '');
    this.qualificationTitle.set(revision.qualificationTitle ?? '');
    this.issuer.set(revision.issuer ?? '');
    this.resultOrStatus.set(revision.resultOrStatus ?? '');
    this.projectRole.set(revision.projectRole ?? '');
    this.description.set(revision.description ?? '');
    this.responsibilities.set(revision.responsibilities ?? '');
    this.achievements.set(revision.achievements ?? '');
    this.careerBreakReason.set(revision.careerBreakReason ?? '');
    this.ongoing.set(revision.ongoing);
    this.startDate.set(this.dateValue(revision.startDate));
    this.endDate.set(this.dateValue(revision.endDate));
    this.issueDate.set(this.dateValue(revision.issueDate));
    this.expiryDate.set(this.dateValue(revision.expiryDate));
    this.demonstratedSkills.set(revision.demonstratedSkills.join(', '));
    this.supportingLinks.set(revision.supportingLinks.join('\n'));
    this.editingEntry.set(entry);
    this.editorMode.set('edit');
    this.error.set(null);
  }

  cancelEditor(): void {
    if (!this.busy()) {
      this.editorMode.set(null);
      this.editingEntry.set(null);
      this.error.set(null);
    }
  }

  async saveDraft(): Promise<void> {
    const validation = this.validationError();
    if (validation) {
      this.error.set(validation);
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const request = this.request();
      const existing = this.editingEntry();
      if (this.editorMode() === 'edit' && existing) {
        await firstValueFrom(this.api.updateEvidence(
          existing.entryId, request, `"${existing.version}"`,
          'body', false, {transferCache: false}));
      } else {
        await firstValueFrom(this.api.createEvidence(
          request, 'body', false, {transferCache: false}));
      }
      this.notify.emit({
        message: existing ? 'A new draft revision was saved.' : 'Draft evidence was added.',
        type: 'success',
      });
      this.editorMode.set(null);
      this.editingEntry.set(null);
      await this.load();
    } catch (error) {
      this.handleWriteError(error);
    } finally {
      this.browserSession.invalidateCsrf();
      this.busy.set(false);
    }
  }

  async perform(entry: EvidenceEntry, action: EvidenceAction): Promise<void> {
    if (action === 'archive') {
      this.pendingArchive.set(entry);
      return;
    }
    await this.executeAction(entry, action);
  }

  async confirmArchive(): Promise<void> {
    const entry = this.pendingArchive();
    if (!entry) return;
    this.pendingArchive.set(null);
    await this.executeAction(entry, 'archive');
  }

  openSupersede(entry: EvidenceEntry): void {
    this.pendingSupersede.set(entry);
    this.replacementEntryId.set('');
    this.error.set(null);
  }

  async confirmSupersede(): Promise<void> {
    const entry = this.pendingSupersede();
    const replacementEntryId = this.replacementEntryId();
    if (!entry || !this.replacementEntries().some(candidate =>
      candidate.entryId === replacementEntryId)) {
      this.error.set('Choose the active evidence that replaces this item.');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      await firstValueFrom(this.api.supersedeEvidence(
        entry.entryId,
        {replacementEntryId},
        `"${entry.version}"`,
      ));
      this.notify.emit({
        message: 'Evidence superseded and retained for history.',
        type: 'success',
      });
      this.pendingSupersede.set(null);
      this.replacementEntryId.set('');
      await this.load();
    } catch (error) {
      this.handleWriteError(error);
    } finally {
      this.browserSession.invalidateCsrf();
      this.busy.set(false);
    }
  }

  async executeAction(entry: EvidenceEntry, action: EvidenceAction): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(this.browserSession.ensureCsrf());
      const version = `"${entry.version}"`;
      if (action === 'confirm') {
        await firstValueFrom(this.api.confirmEvidence(entry.entryId, version));
      } else if (action === 'archive') {
        await firstValueFrom(this.api.archiveEvidence(entry.entryId, version));
      } else if (action === 'restore') {
        await firstValueFrom(this.api.restoreEvidence(entry.entryId, version));
      } else if (action === 'hide') {
        await firstValueFrom(this.api.hideEvidence(entry.entryId, version));
      } else {
        await firstValueFrom(this.api.showEvidence(entry.entryId, version));
      }
      this.notify.emit({message: this.actionMessage(action), type: 'success'});
      await this.load();
    } catch (error) {
      this.handleWriteError(error);
    } finally {
      this.browserSession.invalidateCsrf();
      this.busy.set(false);
    }
  }

  latest(entry: EvidenceEntry): EvidenceRevision | undefined {
    return [...entry.revisions].sort((left, right) =>
      right.revisionNumber - left.revisionNumber)[0];
  }

  categoryLabel(category: string): string {
    return this.categories.find(option => option[0] === category)?.[1] ?? category;
  }

  toggleView(entry: EvidenceEntry): void {
    this.viewingEntryId.update(current =>
      current === entry.entryId ? null : entry.entryId);
  }

  dateRange(revision?: EvidenceRevision): string {
    if (!revision) return 'No date supplied';
    const start = revision.startDate ?? revision.issueDate;
    const end = revision.ongoing ? undefined : revision.endDate ?? revision.expiryDate;
    if (!start && !end) return 'No date supplied';
    if (revision.ongoing && start) return `${this.displayDate(start)} – present`;
    if (start && end) return `${this.displayDate(start)} – ${this.displayDate(end)}`;
    return this.displayDate(start ?? end!);
  }

  needsRole(): boolean {
    return ['EMPLOYMENT', 'FREELANCE', 'VOLUNTEERING'].includes(this.category());
  }

  private request(): EvidenceWriteRequest {
    return {
      category: this.category() as EvidenceWriteRequestCategoryEnum,
      heading: this.heading().trim(),
      ...(this.organisationContext().trim()
        ? {organisationContext: this.organisationContext().trim()} : {}),
      ...(this.roleTitle().trim() ? {roleTitle: this.roleTitle().trim()} : {}),
      ...(this.programmeOrSubject().trim()
        ? {programmeOrSubject: this.programmeOrSubject().trim()} : {}),
      ...(this.institution().trim() ? {institution: this.institution().trim()} : {}),
      ...(this.qualificationTitle().trim()
        ? {qualificationTitle: this.qualificationTitle().trim()} : {}),
      ...(this.issuer().trim() ? {issuer: this.issuer().trim()} : {}),
      ...(this.resultOrStatus().trim() ? {resultOrStatus: this.resultOrStatus().trim()} : {}),
      ...(this.projectRole().trim() ? {projectRole: this.projectRole().trim()} : {}),
      ...(this.description().trim() ? {description: this.description().trim()} : {}),
      ...(this.responsibilities().trim()
        ? {responsibilities: this.responsibilities().trim()} : {}),
      ...(this.achievements().trim() ? {achievements: this.achievements().trim()} : {}),
      ...(this.careerBreakReason().trim()
        ? {careerBreakReason: this.careerBreakReason().trim()} : {}),
      ongoing: this.ongoing(),
      ...(this.startDate() ? {startDate: this.partialDate(this.startDate())} : {}),
      ...(!this.ongoing() && this.endDate()
        ? {endDate: this.partialDate(this.endDate())} : {}),
      ...(this.issueDate() ? {issueDate: this.partialDate(this.issueDate())} : {}),
      ...(this.expiryDate() ? {expiryDate: this.partialDate(this.expiryDate())} : {}),
      demonstratedSkills: this.csv(this.demonstratedSkills()),
      supportingLinks: this.supportingLinks().split(/\r?\n/).map(value => value.trim()).filter(Boolean),
    };
  }

  private validationError(): string | null {
    if (!this.heading().trim()) return 'Add a clear heading.';
    if (this.needsRole() && (!this.roleTitle().trim() || !this.organisationContext().trim())) {
      return 'Add the role and organisation or context for this category.';
    }
    if (this.category() === 'EDUCATION'
      && (!this.programmeOrSubject().trim() || !this.institution().trim())) {
      return 'Add the programme or subject and institution.';
    }
    if (this.category() === 'QUALIFICATION_TRAINING'
      && (!this.qualificationTitle().trim() || !this.issuer().trim())) {
      return 'Add the qualification title and issuer.';
    }
    if (this.category() === 'ACHIEVEMENT'
      && !this.achievements().trim() && !this.description().trim()) {
      return 'Describe the achievement exactly as you want it recorded.';
    }
    if (this.category() === 'OTHER' && !this.description().trim()) {
      return 'Add a description for this evidence.';
    }
    if (this.supportingLinks().split(/\r?\n/).some(value =>
      value.trim() && !value.trim().startsWith('https://'))) {
      return 'Supporting links must start with https://.';
    }
    return null;
  }

  private partialDate(value: string): PartialDate {
    const [year, month, day] = value.split('-').map(Number);
    return {precision: PartialDatePrecisionEnum.Day, year, month, day};
  }

  private dateValue(value?: PartialDate | null): string {
    if (!value) return '';
    if (value.precision === PartialDatePrecisionEnum.Year) return `${value.year}-01-01`;
    if (value.precision === PartialDatePrecisionEnum.Month) {
      return `${value.year}-${String(value.month).padStart(2, '0')}-01`;
    }
    return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;
  }

  private displayDate(value: PartialDate): string {
    if (value.precision === PartialDatePrecisionEnum.Year) return String(value.year);
    const month = String(value.month).padStart(2, '0');
    if (value.precision === PartialDatePrecisionEnum.Month) return `${month}/${value.year}`;
    return `${String(value.day).padStart(2, '0')}/${month}/${value.year}`;
  }

  private csv(value: string): string[] {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }

  private resetForm(): void {
    this.category.set(EvidenceEntryCategoryEnum.Employment);
    for (const field of [
      this.heading, this.organisationContext, this.roleTitle,
      this.programmeOrSubject, this.institution, this.qualificationTitle,
      this.issuer, this.resultOrStatus, this.projectRole, this.description,
      this.responsibilities, this.achievements, this.careerBreakReason,
      this.startDate, this.endDate, this.issueDate, this.expiryDate,
      this.demonstratedSkills, this.supportingLinks,
    ]) field.set('');
    this.ongoing.set(false);
  }

  private handleWriteError(error: unknown): void {
    this.browserSession.handleAuthenticatedError(error);
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as {status?: unknown}).status)
      : undefined;
    this.error.set(status === 409
      ? 'This evidence changed in another session. Reload it before trying again.'
      : 'This change could not be saved.');
  }

  private actionMessage(action: EvidenceAction): string {
    return {
      confirm: 'Entry confirmed by you and available for future documents.',
      archive: 'Entry archived and retained for history.',
      restore: 'Entry restored.',
      hide: 'Entry hidden.',
      show: 'Entry visible.',
    }[action];
  }
}
