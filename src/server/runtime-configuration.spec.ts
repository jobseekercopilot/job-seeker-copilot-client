import {
  commuteRoutingMode,
  documentGenerationMode,
  jobSearchProviderMode,
  publicLegalConfiguration,
} from './runtime-configuration';

describe('job-search runtime mode', () => {
  it('defaults to the safe fixture label', () => {
    expect(jobSearchProviderMode({})).toBe('FIXTURE');
  });

  it('accepts only the two explicit runtime modes', () => {
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'real'})).toBe('REAL_PROVIDERS');
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'REAL_PROVIDERS'}))
      .toBe('REAL_PROVIDERS');
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'FIXTURE'})).toBe('FIXTURE');
  });

  it('does not echo or expose an invalid setting', () => {
    expect(jobSearchProviderMode({JOB_SEARCH_PROVIDER_MODE: 'secret-value'}))
      .toBe('REQUIRED_VALIDATION');
  });
});

describe('public legal configuration', () => {
  const reviewed = {
    LEGAL_DOCUMENTS_REVIEWED: 'true',
    LEGAL_EFFECTIVE_DATE: '2026-09-01',
    LEGAL_VERSION: 'beta-1',
    LEGAL_ENTITY_TYPE: 'SOLE_TRADER',
    TAX_STATUS: 'NOT_VAT_REGISTERED',
    LEGAL_ENTITY_NAME: 'Northstar Career Services',
    TRADING_NAME: 'Job Seeker Copilot',
    BUSINESS_ADDRESS: '10 High Street, London, SW1A 1AA',
    PRIVACY_EMAIL: 'privacy@jobseekercopilot.com',
    SUPPORT_EMAIL: 'support@jobseekercopilot.com',
    ICO_REGISTRATION_STATUS: 'NOT_REQUIRED_CONFIRMED',
    ACCOUNT_DELETION_COMPLETION_DAYS: '30',
    DOCUMENT_DELETION_COMPLETION_DAYS: '30',
    SECURITY_LOG_RETENTION_DAYS: '30',
    SUPPORT_RECORD_RETENTION_DAYS: '365',
    FINANCIAL_RECORD_RETENTION_YEARS: '6',
  };

  it('exposes reviewed public identity only when every release field is valid', () => {
    expect(publicLegalConfiguration(reviewed)).toMatchObject({
      ready: true,
      status: 'REVIEWED',
      minimumUserAge: 18,
      legalEntityType: 'SOLE_TRADER',
      taxStatus: 'NOT_VAT_REGISTERED',
      effectiveDate: '2026-09-01',
      controllerName: 'Northstar Career Services',
    });
  });

  it('pins the reviewed public-beta age policy to UK adults aged 18+', () => {
    expect(publicLegalConfiguration(reviewed).minimumUserAge).toBe(18);
  });

  it('fails closed without exposing a partial identity or draft effective date', () => {
    expect(publicLegalConfiguration({...reviewed, BUSINESS_ADDRESS: ''}))
      .toEqual({
        ready: false,
        status: 'DRAFT',
        minimumUserAge: 18,
        legalEntityType: 'NOT_CONFIGURED',
        taxStatus: 'NOT_CONFIGURED',
      });
    expect(publicLegalConfiguration({}))
      .toEqual({
        ready: false,
        status: 'DRAFT',
        minimumUserAge: 18,
        legalEntityType: 'NOT_CONFIGURED',
        taxStatus: 'NOT_CONFIGURED',
      });
  });

  it('fails closed until both seller form and tax status are explicitly reviewed', () => {
    expect(publicLegalConfiguration({...reviewed, LEGAL_ENTITY_TYPE: ''}).ready).toBe(false);
    expect(publicLegalConfiguration({...reviewed, TAX_STATUS: ''}).ready).toBe(false);
    expect(publicLegalConfiguration({...reviewed, TAX_STATUS: 'VAT_NOT_CHARGED'}).ready)
      .toBe(false);
  });

  it('fails closed for impossible dates and release placeholders', () => {
    expect(publicLegalConfiguration({...reviewed, LEGAL_EFFECTIVE_DATE: '2026-02-30'}).ready)
      .toBe(false);
    expect(publicLegalConfiguration({...reviewed, LEGAL_ENTITY_NAME: 'Example Legal Entity'}).ready)
      .toBe(false);
    expect(publicLegalConfiguration({...reviewed, BUSINESS_ADDRESS: 'Address supplied at release'}).ready)
      .toBe(false);
  });
});

describe('commute-routing runtime mode', () => {
  it('defaults to distance-only and requires an exact opt-in for paid routing', () => {
    expect(commuteRoutingMode({})).toBe('DISTANCE_ONLY');
    expect(commuteRoutingMode({COMMUTE_ROUTING_MODE: 'DISTANCE_ONLY'}))
      .toBe('DISTANCE_ONLY');
    expect(commuteRoutingMode({COMMUTE_ROUTING_MODE: 'GOOGLE_ROUTES'}))
      .toBe('GOOGLE_ROUTES');
  });

  it('fails closed without echoing an invalid setting', () => {
    expect(commuteRoutingMode({COMMUTE_ROUTING_MODE: 'secret-value'}))
      .toBe('REQUIRED_VALIDATION');
  });
});

describe('document-generation runtime mode', () => {
  it('fails closed when no explicit mode is configured', () => {
    expect(documentGenerationMode({})).toBe('REQUIRED_VALIDATION');
  });

  it('distinguishes fixture-backed and real OpenAI generation', () => {
    expect(documentGenerationMode({DOCUMENT_GENERATION_MODE: 'FIXTURE_LLM'}))
      .toBe('FIXTURE_LLM');
    expect(documentGenerationMode({DOCUMENT_GENERATION_MODE: 'LIVE'}))
      .toBe('REAL_LLM');
    expect(documentGenerationMode({DOCUMENT_GENERATION_MODE: 'REAL_LLM'}))
      .toBe('REAL_LLM');
  });

  it('does not echo or expose an invalid setting', () => {
    expect(documentGenerationMode({DOCUMENT_GENERATION_MODE: 'secret-value'}))
      .toBe('REQUIRED_VALIDATION');
  });
});
