import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Job } from '../../models/job-search.model';

@Component({
  selector: 'app-job-card',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './job-card.component.html',
  styleUrl: './job-card.component.css'
})
export class JobCardComponent {
  job = input.required<Job>();

  expanded = signal(false);

  toggle(): void {
    this.expanded.update(v => !v);
  }

  formatSalary(salary: { min: number; max: number; currency: string } | undefined | null): string {
    if (!salary || typeof salary.min !== 'number' || typeof salary.max !== 'number') {
      return 'Salary not specified';
    }
    return `${salary.currency ?? 'GBP'} ${salary.min.toLocaleString()} - ${salary.max.toLocaleString()}`;
  }

  formatDate(dateString: string | undefined | null): string {
    if (!dateString) return 'Date unknown';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
}