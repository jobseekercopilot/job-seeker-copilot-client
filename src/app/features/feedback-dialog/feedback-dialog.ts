import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import {MAT_DIALOG_DATA, MatDialogRef} from '@angular/material/dialog';
import {firstValueFrom} from 'rxjs';
import {
  coarseFeedbackDiagnostics,
  createFeedbackIdempotencyKey,
  FeedbackCategory,
  FeedbackService,
  FeedbackSubmission,
  feedbackPayloadValidationError,
  feedbackSubmissionErrorMessage,
  feedbackTextIsValid,
  normaliseFeedbackText,
} from '../../services/feedback.service';

export interface FeedbackDialogData {
  submissionUrl: string;
  pagePath: string;
  appBuild: string;
}

const textBounds = (
  minimum: number,
  maximum: number,
  multiline: boolean,
): ValidatorFn => (control: AbstractControl): ValidationErrors | null =>
  typeof control.value === 'string'
  && feedbackTextIsValid(control.value, minimum, maximum, multiline)
    ? null
    : {feedbackText: true};

@Component({
  selector: 'app-feedback-dialog',
  imports: [ReactiveFormsModule],
  templateUrl: './feedback-dialog.html',
  styleUrl: './feedback-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedbackDialogComponent {
  private readonly data = inject<FeedbackDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<FeedbackDialogComponent>);
  private readonly feedback = inject(FeedbackService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly idempotencyKey = createFeedbackIdempotencyKey();
  private readonly formStartedAt = Math.max(1, Date.now());

  readonly categories: readonly (readonly [FeedbackCategory, string])[] = [
    ['BROKEN', 'Something is broken'],
    ['CONFUSING', 'Something is confusing'],
    ['SUGGESTION', 'Feature suggestion'],
    ['OTHER', 'Other feedback'],
  ];
  readonly form = new FormGroup({
    category: new FormControl<FeedbackCategory>('BROKEN', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    title: new FormControl('', {
      nonNullable: true,
      validators: [textBounds(5, 120, false)],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [textBounds(10, 2_000, true)],
    }),
    reproductionSteps: new FormControl('', {
      nonNullable: true,
      validators: [textBounds(0, 1_200, true)],
    }),
    diagnosticsConsent: new FormControl(false, {nonNullable: true}),
    website: new FormControl('', {nonNullable: true}),
  });
  readonly submitted = signal(false);
  readonly busy = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly acceptedReference = signal<string | null>(null);

  close(): void {
    this.dialogRef.close();
  }

  async submit(): Promise<void> {
    if (this.busy() || this.acceptedReference()) return;
    this.submitted.set(true);
    this.form.markAllAsTouched();
    this.errorMessage.set(null);
    if (this.form.invalid || this.form.controls.website.value) return;

    const payload = this.buildPayload();
    const validationError = feedbackPayloadValidationError(payload);
    if (validationError) {
      this.errorMessage.set(validationError === 'REQUEST_TOO_LARGE'
        ? 'Feedback is too long to send. Shorten the description or steps and try again.'
        : 'Some feedback fields could not be accepted. Review the form and try again.');
      return;
    }

    this.busy.set(true);
    try {
      const response = await firstValueFrom(
        this.feedback.submit(this.data.submissionUrl, payload),
      );
      this.acceptedReference.set(response.reference);
      this.changeDetector.detectChanges();
      this.host.nativeElement
        .querySelector<HTMLElement>('#feedback-confirmation-title')
        ?.focus();
    } catch (error: unknown) {
      this.errorMessage.set(feedbackSubmissionErrorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  showError(control: AbstractControl): boolean {
    return control.invalid && (this.submitted() || control.touched);
  }

  characterCount(control: AbstractControl): number {
    return typeof control.value === 'string' ? [...control.value].length : 0;
  }

  private buildPayload(): FeedbackSubmission {
    const values = this.form.getRawValue();
    const diagnosticsConsent = values.diagnosticsConsent;
    return {
      appBuild: this.data.appBuild,
      category: values.category,
      title: normaliseFeedbackText(values.title, false),
      description: normaliseFeedbackText(values.description, true),
      reproductionSteps: normaliseFeedbackText(values.reproductionSteps, true),
      pagePath: this.data.pagePath,
      diagnosticsConsent,
      diagnostics: diagnosticsConsent
        ? coarseFeedbackDiagnostics(navigator.userAgent)
        : null,
      idempotencyKey: this.idempotencyKey,
      website: '',
      formStartedAt: this.formStartedAt,
    };
  }
}
