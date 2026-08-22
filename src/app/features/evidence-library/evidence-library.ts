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
import {MatDialogRef} from '@angular/material/dialog';
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
type CompletionStatus = 'Completed' | 'In progress';
type DateField = 'startDate' | 'endDate' | 'issueDate' | 'expiryDate';

@Component({
  selector: 'app-evidence-library',
  host: {
    'data-testid': 'evidence-library',
    'data-demo-focus': 'app-evidence-library',
    'data-demo-focus-id': 'evidence-library',
  },
  imports: [CommonModule, FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './evidence-library.html',
  styleUrl: './evidence-library.css',
})
export class EvidenceLibraryComponent implements OnInit {
  private readonly api = inject(EvidenceLibraryService);
  private readonly browserSession = inject(BrowserSessionService);
  private readonly dialogRef = inject<MatDialogRef<EvidenceLibraryComponent> | null>(
    MatDialogRef,
    {optional: true},
  );
  private loadSequence = 0;
  private originalDates: Partial<Record<DateField, PartialDate>> = {};
  private preserveLegacyHeading = false;

  readonly notify = output<{message: string; type: 'success' | 'info' | 'error'}>();
  readonly changed = output<void>();
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
  readonly privateCredentialIdentifier = signal('');
  readonly ongoing = signal(false);
  readonly completionStatus = signal<CompletionStatus>('Completed');
  readonly startDate = signal('');
  readonly endDate = signal('');
  readonly issueDate = signal('');
  readonly expiryDate = signal('');
  readonly demonstratedSkills = signal('');
  readonly supportingLinks = signal('');
  readonly advancedExpanded = signal(false);
  readonly conditionalDateMessage = signal('');
  readonly inDialog = Boolean(this.dialogRef);

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
    const requestSequence = ++this.loadSequence;
    this.loading.set(true);
    this.error.set(null);
    try {
      const entries = await firstValueFrom(
        this.api.listEvidence(this.includeArchived(), 'body', false, {transferCache: false}),
      );
      if (requestSequence === this.loadSequence) {
        this.entries.set(entries);
      }
    } catch (error) {
      if (requestSequence === this.loadSequence) {
        this.browserSession.handleAuthenticatedError(error);
        this.error.set('Your experience and achievements could not be loaded. Try again.');
      }
    } finally {
      if (requestSequence === this.loadSequence) {
        this.loading.set(false);
      }
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
    this.privateCredentialIdentifier.set(revision.privateCredentialIdentifier ?? '');
    const completionStatus = this.statusFrom(revision);
    this.completionStatus.set(completionStatus);
    this.ongoing.set(this.usesCompletionStatus() ? false : revision.ongoing);
    const completionDate = completionStatus === 'Completed'
      ? revision.issueDate ?? revision.endDate
      : undefined;
    const expectedDate = completionStatus === 'In progress'
      ? revision.endDate ?? revision.issueDate
      : undefined;
    this.originalDates = {
      startDate: revision.startDate,
      endDate: this.usesCompletionStatus() ? expectedDate : revision.endDate,
      issueDate: this.usesCompletionStatus() ? completionDate : revision.issueDate,
      expiryDate: revision.expiryDate,
    };
    this.startDate.set(this.dateValue(this.originalDates.startDate));
    this.endDate.set(this.dateValue(this.originalDates.endDate));
    this.issueDate.set(this.dateValue(this.originalDates.issueDate));
    this.expiryDate.set(this.dateValue(revision.expiryDate));
    this.demonstratedSkills.set(revision.demonstratedSkills.join(', '));
    this.supportingLinks.set(revision.supportingLinks.join('\n'));
    this.preserveLegacyHeading = this.hasDerivedHeading()
      && revision.heading.trim() !== this.derivedHeading();
    this.advancedExpanded.set(false);
    this.conditionalDateMessage.set('');
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

  closeManager(): void {
    this.dialogRef?.close();
  }

  changeCategory(category: string): void {
    if (this.editorMode() === 'edit') return;
    this.resetForm(category);
  }

  setOngoing(ongoing: boolean): void {
    this.ongoing.set(ongoing);
    if (ongoing) {
      this.endDate.set('');
      delete this.originalDates.endDate;
      this.conditionalDateMessage.set(
        'Current selected. The end date was removed and will not be saved.',
      );
    } else {
      this.conditionalDateMessage.set('Current cleared. You can now add an end date.');
    }
  }

  setCompletionStatus(status: CompletionStatus): void {
    this.completionStatus.set(status);
    this.ongoing.set(false);
    if (status === 'Completed') {
      this.endDate.set('');
      this.expiryDate.set('');
      delete this.originalDates.endDate;
      delete this.originalDates.expiryDate;
      this.conditionalDateMessage.set(
        'Completed selected. Only the completion date is required.',
      );
    } else {
      this.issueDate.set('');
      this.expiryDate.set('');
      delete this.originalDates.issueDate;
      delete this.originalDates.expiryDate;
      this.conditionalDateMessage.set(
        'In progress selected. Only the expected completion date is required.',
      );
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
      this.changed.emit();
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
      this.changed.emit();
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
      this.changed.emit();
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

  revisions(entry: EvidenceEntry): EvidenceRevision[] {
    return [...entry.revisions].sort((left, right) =>
      right.revisionNumber - left.revisionNumber);
  }

  revisionCreatedAt(revision: EvidenceRevision): string {
    const value = new Date(revision.createdAt);
    return Number.isNaN(value.getTime())
      ? revision.createdAt
      : value.toLocaleDateString('en-GB');
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

  hasDerivedHeading(): boolean {
    return [
      'EMPLOYMENT',
      'EDUCATION',
      'QUALIFICATION_TRAINING',
      'VOLUNTEERING',
      'FREELANCE',
    ].includes(this.category());
  }

  usesCompletionStatus(): boolean {
    return ['EDUCATION', 'QUALIFICATION_TRAINING'].includes(this.category());
  }

  usesDateRange(): boolean {
    return [
      'EMPLOYMENT',
      'PROJECT',
      'VOLUNTEERING',
      'FREELANCE',
      'CAREER_BREAK',
      'OTHER',
    ].includes(this.category());
  }

  showsRoleAdvancedDetail(): boolean {
    return ['EMPLOYMENT', 'VOLUNTEERING', 'FREELANCE'].includes(this.category());
  }

  showsOutcomeAdvancedDetail(): boolean {
    return [
      'EMPLOYMENT',
      'EDUCATION',
      'PROJECT',
      'VOLUNTEERING',
      'FREELANCE',
      'ACHIEVEMENT',
      'OTHER',
    ].includes(this.category());
  }

  supportsAdvancedDetails(): boolean {
    return this.category() !== 'CAREER_BREAK';
  }

  private request(): EvidenceWriteRequest {
    const category = this.category();
    const request: EvidenceWriteRequest = {
      category: category as EvidenceWriteRequestCategoryEnum,
      heading: this.effectiveHeading(),
    };
    const text = (value: string): string | undefined => value.trim() || undefined;
    const setAdvancedCommon = (): void => {
      request.demonstratedSkills = this.csv(this.demonstratedSkills());
      request.supportingLinks = this.links();
    };
    const setRange = (): void => {
      request.ongoing = this.ongoing();
      if (this.startDate()) request.startDate = this.savedDate('startDate', this.startDate());
      if (!this.ongoing() && this.endDate()) {
        request.endDate = this.savedDate('endDate', this.endDate());
      }
    };

    switch (category) {
      case 'EMPLOYMENT':
        request.roleTitle = text(this.roleTitle());
        request.organisationContext = text(this.organisationContext());
        request.description = text(this.description());
        request.responsibilities = text(this.responsibilities());
        request.achievements = text(this.achievements());
        setRange();
        setAdvancedCommon();
        break;
      case 'EDUCATION':
        request.programmeOrSubject = text(this.programmeOrSubject());
        request.institution = text(this.institution());
        request.resultOrStatus = this.completionStatus();
        request.description = text(this.description());
        request.achievements = text(this.achievements());
        if (this.completionStatus() === 'Completed' && this.issueDate()) {
          request.issueDate = this.savedDate('issueDate', this.issueDate());
        } else if (this.endDate()) {
          request.endDate = this.savedDate('endDate', this.endDate());
        }
        setAdvancedCommon();
        break;
      case 'QUALIFICATION_TRAINING':
        request.qualificationTitle = text(this.qualificationTitle());
        request.issuer = text(this.issuer());
        request.resultOrStatus = this.completionStatus();
        request.description = text(this.description());
        if (this.completionStatus() === 'Completed' && this.issueDate()) {
          request.issueDate = this.savedDate('issueDate', this.issueDate());
          if (this.expiryDate()) {
            request.expiryDate = this.savedDate('expiryDate', this.expiryDate());
          }
        } else if (this.endDate()) {
          request.endDate = this.savedDate('endDate', this.endDate());
        }
        request.privateCredentialIdentifier = text(this.privateCredentialIdentifier());
        setAdvancedCommon();
        break;
      case 'PROJECT':
        request.projectRole = text(this.projectRole());
        request.organisationContext = text(this.organisationContext());
        request.description = text(this.description());
        request.achievements = text(this.achievements());
        setRange();
        setAdvancedCommon();
        break;
      case 'VOLUNTEERING':
        request.roleTitle = text(this.roleTitle());
        request.organisationContext = text(this.organisationContext());
        request.description = text(this.description());
        request.responsibilities = text(this.responsibilities());
        request.achievements = text(this.achievements());
        setRange();
        setAdvancedCommon();
        break;
      case 'FREELANCE':
        request.roleTitle = text(this.roleTitle());
        request.organisationContext = text(this.organisationContext());
        request.description = text(this.description());
        request.responsibilities = text(this.responsibilities());
        request.achievements = text(this.achievements());
        setRange();
        setAdvancedCommon();
        break;
      case 'ACHIEVEMENT':
        request.description = text(this.description());
        request.achievements = text(this.achievements());
        request.ongoing = false;
        if (this.issueDate()) request.issueDate = this.savedDate('issueDate', this.issueDate());
        setAdvancedCommon();
        break;
      case 'CAREER_BREAK':
        request.description = text(this.description());
        setRange();
        break;
      case 'OTHER':
        request.organisationContext = text(this.organisationContext());
        request.description = text(this.description());
        request.achievements = text(this.achievements());
        setRange();
        setAdvancedCommon();
        break;
    }
    return request;
  }

  private validationError(): string | null {
    if (!this.effectiveHeading()) return 'Add a clear heading.';
    if (this.category() === 'EMPLOYMENT'
      && (!this.roleTitle().trim() || !this.organisationContext().trim())) {
      return 'Add the role and employer.';
    }
    if (this.category() === 'EMPLOYMENT'
      && (!this.startDate() || (!this.ongoing() && !this.endDate()))) {
      return 'Add the start date and either an end date or Current.';
    }
    if (this.category() === 'EDUCATION'
      && (!this.programmeOrSubject().trim() || !this.institution().trim())) {
      return 'Add the programme or subject and institution.';
    }
    if (this.category() === 'QUALIFICATION_TRAINING'
      && (!this.qualificationTitle().trim() || !this.issuer().trim())) {
      return 'Add the qualification title and issuer.';
    }
    if (this.usesCompletionStatus()) {
      const date = this.completionStatus() === 'Completed' ? this.issueDate() : this.endDate();
      if (!date) {
        return this.completionStatus() === 'Completed'
          ? 'Add the completion date.'
          : 'Add the expected completion date.';
      }
    }
    if (this.category() === 'VOLUNTEERING'
      && (!this.roleTitle().trim() || !this.organisationContext().trim())) {
      return 'Add the volunteering role and organisation.';
    }
    if (this.category() === 'FREELANCE' && !this.roleTitle().trim()) {
      return 'Add the freelance role or service.';
    }
    if (['PROJECT', 'VOLUNTEERING', 'FREELANCE', 'ACHIEVEMENT', 'OTHER']
      .includes(this.category()) && !this.description().trim()) {
      return 'Add a description for this evidence.';
    }
    if ([this.description(), this.responsibilities(), this.achievements()]
      .some(value => value.length > 2000)) {
      return 'Keep each description or detail field to 2,000 characters or fewer.';
    }
    if (this.links().some(value => !value.startsWith('https://'))) {
      return 'Supporting links must start with https://.';
    }
    return null;
  }

  private partialDate(value: string): PartialDate {
    const [year, month, day] = value.split('-').map(Number);
    return {precision: PartialDatePrecisionEnum.Day, year, month, day};
  }

  private savedDate(field: DateField, value: string): PartialDate {
    const original = this.originalDates[field];
    return original && this.dateValue(original) === value
      ? original
      : this.partialDate(value);
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

  private links(): string[] {
    return this.supportingLinks().split(/\r?\n/)
      .map(value => value.trim())
      .filter(Boolean);
  }

  private derivedHeading(): string {
    switch (this.category()) {
      case 'EMPLOYMENT':
      case 'VOLUNTEERING':
      case 'FREELANCE':
        return this.roleTitle().trim();
      case 'EDUCATION':
        return this.programmeOrSubject().trim();
      case 'QUALIFICATION_TRAINING':
        return this.qualificationTitle().trim();
      default:
        return this.heading().trim();
    }
  }

  private effectiveHeading(): string {
    if (!this.hasDerivedHeading()) return this.heading().trim();
    if (this.editorMode() === 'edit' && this.preserveLegacyHeading) {
      return this.heading().trim();
    }
    return this.derivedHeading();
  }

  private statusFrom(revision: EvidenceRevision): CompletionStatus {
    const value = revision.resultOrStatus?.trim().toUpperCase().replace(/\s+/g, '_');
    return value === 'IN_PROGRESS' || revision.ongoing
      ? 'In progress'
      : 'Completed';
  }

  private resetForm(category: string = EvidenceEntryCategoryEnum.Employment): void {
    this.category.set(category);
    for (const field of [
      this.heading, this.organisationContext, this.roleTitle,
      this.programmeOrSubject, this.institution, this.qualificationTitle,
      this.issuer, this.resultOrStatus, this.projectRole, this.description,
      this.responsibilities, this.achievements, this.privateCredentialIdentifier,
      this.startDate, this.endDate, this.issueDate, this.expiryDate,
      this.demonstratedSkills, this.supportingLinks,
    ]) field.set('');
    this.ongoing.set(false);
    this.completionStatus.set('Completed');
    this.advancedExpanded.set(false);
    this.conditionalDateMessage.set('');
    this.originalDates = {};
    this.preserveLegacyHeading = false;
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
