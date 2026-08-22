import { ChangeDetectionStrategy, Component, model, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import type { Role } from '../../api';

type RoleStatus = 'CURRENT' | 'PREVIOUS_ROLE';

@Component({
  selector: 'app-role-form',
  imports: [CommonModule, MatIconModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './role-form.html',
  styleUrl: './role-form.css'
})
export class RoleFormComponent {
  items = model<Role[]>([]);

  editingIndex = signal<number | null>(null);
  newItemFlag = signal(false);

  editForm = { jobTitle: '', employer: '', status: 'PREVIOUS_ROLE' as RoleStatus, startDate: '', endDate: '', keyResponsibilities: '' };
  editFormErrors = signal<Record<string, string>>({});

  isNew = () => this.newItemFlag();

  private resetForm() {
    this.editForm.jobTitle = '';
    this.editForm.employer = '';
    this.editForm.status = 'PREVIOUS_ROLE';
    this.editForm.startDate = '';
    this.editForm.endDate = '';
    this.editForm.keyResponsibilities = '';
    this.editFormErrors.set({});
  }

  startNew() {
    this.resetForm();
    this.newItemFlag.set(true);
    this.editingIndex.set(-1);
  }

  startEdit(index: number) {
    const role = this.items()[index];
    this.editForm.jobTitle = role.jobTitle || '';
    this.editForm.employer = role.employer || '';
    this.editForm.status = (role.status as RoleStatus) || 'PREVIOUS_ROLE';
    this.editForm.startDate = role.startDate || '';
    this.editForm.endDate = role.endDate || '';
    this.editForm.keyResponsibilities = role.keyResponsibilities || '';
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
    if (!this.editForm.jobTitle.trim()) errors['jobTitle'] = 'Required';
    if (!this.editForm.employer.trim()) errors['employer'] = 'Required';
    if (!this.editForm.startDate.trim()) errors['startDate'] = 'Required';
    this.editFormErrors.set(errors);
    if (Object.keys(errors).length > 0) return;

    const role: Role = {
      jobTitle: this.editForm.jobTitle.trim(),
      employer: this.editForm.employer.trim(),
      status: this.editForm.status,
      startDate: this.editForm.startDate,
      endDate: this.editForm.endDate || undefined,
      keyResponsibilities: this.editForm.keyResponsibilities.trim()
    };

    const current = [...this.items()];
    if (this.newItemFlag()) {
      current.push(role);
    } else if (this.editingIndex() !== null) {
      current[this.editingIndex()!] = role;
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
