import {ChangeDetectionStrategy, Component, input} from '@angular/core';

@Component({
  selector: 'app-legal-notice',
  standalone: true,
  templateUrl: './legal-notice.html',
  styleUrl: './legal-notice.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LegalNoticeComponent {
  mode = input.required<'privacy' | 'terms'>();
}
