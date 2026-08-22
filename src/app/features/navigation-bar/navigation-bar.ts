import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-navigation-bar',
  imports: [CommonModule, RouterLink, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './navigation-bar.html',
  styleUrl: './navigation-bar.css'
})
export class NavigationBar {
  userName = input<string>('');
  userEmail = input<string>('');
  documentCreditBalance = input<number | null>(null);

  logout = output<void>();
  refreshCredits = output<void>();
  openProfile = output<void>();
  openExperience = output<void>();

  dropdownOpen = signal<boolean>(false);
  tokenDropdownOpen = signal<boolean>(false);

  toggleDropdown() {
    this.dropdownOpen.update(open => !open);
    this.tokenDropdownOpen.set(false);
  }

  closeDropdown() {
    this.dropdownOpen.set(false);
  }

  toggleTokenDropdown() {
    this.tokenDropdownOpen.update(open => !open);
    this.dropdownOpen.set(false);
  }

  closeTokenDropdown() {
    this.tokenDropdownOpen.set(false);
  }

  refreshBalance() {
    this.refreshCredits.emit();
    this.tokenDropdownOpen.set(false);
  }

  triggerLogout() {
    this.logout.emit();
    this.dropdownOpen.set(false);
  }

  triggerProfile(): void {
    this.openProfile.emit();
    this.closeDropdown();
  }

  triggerExperience(): void {
    this.openExperience.emit();
    this.closeDropdown();
  }

  formatCredits(value: number | null): string {
    const count = value ?? 0;
    return `${count.toLocaleString('en-GB')} ${count === 1 ? 'generation' : 'generations'}`;
  }
}
