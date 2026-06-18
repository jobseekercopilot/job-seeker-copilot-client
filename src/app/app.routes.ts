import {Routes} from '@angular/router';
import {JobSeekerDashboardComponent} from './features/job-seeker-dashboard/job-seeker-dashboard';

export const routes: Routes = [
  {
    path: 'dashboard',
    component: JobSeekerDashboardComponent
  },
  {
    path: '',
    redirectTo: '/dashboard',
    pathMatch: 'full'
  }
];