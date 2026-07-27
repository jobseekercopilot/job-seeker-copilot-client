import {Routes} from '@angular/router';
import {JobSeekerDashboardComponent} from './features/job-seeker-dashboard/job-seeker-dashboard';

export const routes: Routes = [
  {path: 'dashboard', component: JobSeekerDashboardComponent},
  {path: 'payment/success', component: JobSeekerDashboardComponent},
  {path: 'payment/cancel', component: JobSeekerDashboardComponent},
  {path: 'payment', component: JobSeekerDashboardComponent},
  {path: 'payment/history', component: JobSeekerDashboardComponent},
  {path: 'tokens', component: JobSeekerDashboardComponent},
  {path: 'tokens/history', component: JobSeekerDashboardComponent},
  {path: '', redirectTo: '/dashboard', pathMatch: 'full'},
];
