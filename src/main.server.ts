import {
  BootstrapContext,
  bootstrapApplication,
} from '@angular/platform-browser';
import {BetaApp} from './app/beta-app';
import {config} from './app/app.config.server';

const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(BetaApp, config, context);

export default bootstrap;
