import {bootstrapApplication} from '@angular/platform-browser';
import {BetaApp} from './app/beta-app';
import {appConfig} from './app/app.config';

bootstrapApplication(BetaApp, appConfig).catch((err) => console.error(err));
