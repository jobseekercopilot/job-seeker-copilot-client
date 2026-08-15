import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {
  DRAFT_LEGAL_CONFIGURATION,
  isReviewedLegalConfiguration,
  PublicLegalConfiguration,
} from '../../services/runtime-configuration.service';

@Component({
  selector: 'app-legal-notice',
  standalone: true,
  templateUrl: './legal-notice.html',
  styleUrl: './legal-notice.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalNoticeComponent {
  mode = input.required<'privacy' | 'terms'>();
  configuration = input<PublicLegalConfiguration>(DRAFT_LEGAL_CONFIGURATION);
  legalReady = computed(() => isReviewedLegalConfiguration(this.configuration()));
}
