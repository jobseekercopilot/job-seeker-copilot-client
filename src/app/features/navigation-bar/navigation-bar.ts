import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-navigation-bar',
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './navigation-bar.html',
  styleUrl: './navigation-bar.css'
})
export class NavigationBar {
  userName = input<string>('Sarah Jenkins');
  userEmail = input<string>('sarah.jenkins@gmail.com');

  resetClaimant = output<void>();
  logout = output<void>();

  dropdownOpen = signal<boolean>(false);

  triggerReset() {
    this.resetClaimant.emit();
    this.dropdownOpen.set(false);
  }

  toggleDropdown() {
    this.dropdownOpen.update(open => !open);
  }

  closeDropdown() {
    this.dropdownOpen.set(false);
  }

  triggerLogout() {
    this.logout.emit();
    this.dropdownOpen.set(false);
  }
}
