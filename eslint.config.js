// @ts-check
const eslint = require('@eslint/js');
const {defineConfig} = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    ignores: [
      'src/app/api/**',
      'src/generated/**',
      'src/app/app.ts',
      'src/app/app.html',
      'src/app/features/documents-workspace/**',
      'src/app/features/job-card/**',
      'src/app/features/job-results/**',
      'src/app/features/job-seeker-dashboard/**',
      'src/app/features/my-applications/**',
      'src/app/features/navigation-bar/**',
      'src/app/features/payment-panel/**',
      'src/app/features/reporting-panel/**',
      'src/app/gateways/job-finder-gateway.ts',
      'src/app/models/job-search.model.ts',
      'src/app/services/application-tracker.service.ts',
      'src/app/services/document-generation.service.ts',
      'src/app/services/job.service.ts',
      'src/app/services/payment.service.ts',
      'src/app/utils/ai-credit.ts',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [
      angular.configs.templateRecommended,
      angular.configs.templateAccessibility,
    ],
    rules: {},
  }
]);
