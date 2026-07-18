import { ChangeDetectionStrategy, Component, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import type { Qualification } from '../../api';

type QualificationStatus = 'IN_PROGRESS' | 'COMPLETED';

@Component({
  selector: 'app-qualification-form',
  imports: [CommonModule, MatIconModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './qualification-form.html',
  styleUrl: './qualification-form.css'
})
export class QualificationFormComponent {
  items = model<Qualification[]>([]);

  editingIndex = signal<number | null>(null);
  newItemFlag = signal(false);

  editForm = { name: '', issuingBody: '', status: 'COMPLETED' as QualificationStatus, grade: '', dateAchieved: '', expectedCompletion: '' };
  editFormErrors = signal<Record<string, string>>({});

  isNew = () => this.newItemFlag();

  private resetForm() {
    this.editForm.name = '';
    this.editForm.issuingBody = '';
    this.editForm.status = 'COMPLETED';
    this.editForm.grade = '';
    this.editForm.dateAchieved = '';
    this.editForm.expectedCompletion = '';
    this.editFormErrors.set({});
  }

  startNew() {
    this.resetForm();
    this.newItemFlag.set(true);
    this.editingIndex.set(-1);
  }

  startEdit(index: number) {
    const qual = this.items()[index];
    this.editForm.name = qual.qualificationName || '';
    this.editForm.issuingBody = qual.issuingBody || '';
    this.editForm.status = (qual.status as QualificationStatus) || 'COMPLETED';
    this.editForm.grade = qual.grade || '';
    this.editForm.dateAchieved = qual.dateAchieved || '';
    this.editForm.expectedCompletion = qual.expectedCompletion || '';
    this.editFormErrors.set({});
    this.newItemFlag.set(false);
    this.editingIndex.set(index);
  }

  cancelEdit() {
    this.editingIndex.set(null);
    this.newItemFlag.set(false);
    this.resetForm();
  }

  saveEdit() {
    const errors: Record<string, string> = {};
    if (!this.editForm.name.trim()) errors['name'] = 'Required';
    if (!this.editForm.issuingBody.trim()) errors['issuingBody'] = 'Required';
    this.editFormErrors.set(errors);
    if (Object.keys(errors).length > 0) return;

    const qual: Qualification = {
      qualificationName: this.editForm.name.trim(),
      issuingBody: this.editForm.issuingBody.trim(),
      status: this.editForm.status,
      grade: this.editForm.grade.trim() || undefined,
      dateAchieved: this.editForm.dateAchieved || undefined,
      expectedCompletion: this.editForm.expectedCompletion || undefined
    };

    const current = [...this.items()];
    if (this.newItemFlag()) {
      current.push(qual);
    } else if (this.editingIndex() !== null) {
      current[this.editingIndex()!] = qual;
    }
    this.items.set(current);
    this.cancelEdit();
  }

  deleteItem(index: number) {
    const current = [...this.items()];
    current.splice(index, 1);
    this.items.set(current);
  }
}
