import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { formatGbpPence, tokensToGbpPence } from '../../utils/ai-credit';

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
  aiTokenBalance = input<number | null>(null);
  aiCreditPencePerToken = input<number | null>(null);

  logout = output<void>();
  refreshTokens = output<void>();
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
    this.refreshTokens.emit();
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

  formatTokens(value: number | null): string {
    return (value ?? 0).toLocaleString();
  }

  formatCredit(value: number | null): string {
    return formatGbpPence(tokensToGbpPence(value, this.aiCreditPencePerToken() ?? undefined));
  }
}
