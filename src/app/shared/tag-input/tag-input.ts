import { ChangeDetectionStrategy, Component, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-tag-input',
  imports: [CommonModule, MatIconModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tag-input.html',
  styleUrl: './tag-input.css'
})
export class TagInputComponent {
  label = model<string>('');
  placeholder = model<string>('Type and press Enter');
  tags = model<string[]>([]);
  error = model<string>('');

  inputValue = signal('');

  inputId(): string {
    return `tag-input-${this.label().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  }

  commitInput() {
    const values = this.inputValue()
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    if (values.length === 0) {
      this.inputValue.set('');
      return;
    }

    const current = [...this.tags()];
    values.forEach(value => {
      if (!current.includes(value)) current.push(value);
    });
    this.tags.set(current);
    this.inputValue.set('');
  }

  handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.commitInput();
    } else if (event.key === 'Backspace' && !this.inputValue() && this.tags().length > 0) {
      this.removeTag(this.tags().length - 1);
    }
  }

  removeTag(index: number) {
    const current = this.tags();
    current.splice(index, 1);
    this.tags.set([...current]);
  }
}
