import {Routes} from '@angular/router';
import {JobSeekerDashboardComponent} from './features/job-seeker-dashboard/job-seeker-dashboard';
import {LandingAuthComponent} from './features/landing-auth/landing-auth';
import {PasswordRecoveryComponent} from './features/password-recovery/password-recovery';
import {LegalNoticeComponent} from './features/legal-notice/legal-notice';

export const routes: Routes = [
  {path: 'register', component: LandingAuthComponent},
  {path: 'sign-in', component: LandingAuthComponent},
  {path: 'forgot-password', component: PasswordRecoveryComponent},
  {path: 'reset-password', component: PasswordRecoveryComponent},
  {path: 'privacy', component: LegalNoticeComponent},
  {path: 'terms', component: LegalNoticeComponent},
  {path: 'dashboard', component: JobSeekerDashboardComponent},
  {path: 'payment/success', component: JobSeekerDashboardComponent},
  {path: 'payment/cancel', component: JobSeekerDashboardComponent},
  {path: 'payment', component: JobSeekerDashboardComponent},
  {path: 'payment/history', component: JobSeekerDashboardComponent},
  {path: 'tokens', redirectTo: '/payment', pathMatch: 'full'},
  {path: 'tokens/history', redirectTo: '/payment/history', pathMatch: 'full'},
  {path: '', redirectTo: '/dashboard', pathMatch: 'full'},
];
