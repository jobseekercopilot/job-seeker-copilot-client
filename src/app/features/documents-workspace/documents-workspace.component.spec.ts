import { DocumentsWorkspaceComponent } from './documents-workspace.component';

describe('DocumentsWorkspaceComponent document actions', () => {
  const component = Object.create(DocumentsWorkspaceComponent.prototype) as DocumentsWorkspaceComponent;

  const document = (status: string, overrides: Record<string, unknown> = {}) => ({
    applicationId: 'application-1',
    documentId: 'document-1',
    status,
    ...overrides,
  });

  it('allows replacement and withdrawal while generated documents remain editable', () => {
    const generated = document('DOCUMENTS_GENERATED');

    expect(component.canReplace(generated as never)).toBe(true);
    expect(component.canDelete(generated as never)).toBe(true);
  });

  it.each([
    'APPLIED',
    'INTERVIEW',
    'OFFER',
    'ACCEPTED',
    'UNSUCCESSFUL',
    'WITHDRAWN',
  ])('locks replacement and withdrawal after the generated-document stage (%s)', status => {
    const locked = document(status);

    expect(component.canReplace(locked as never)).toBe(false);
    expect(component.canDelete(locked as never)).toBe(false);
  });

  it('requires persisted document and application identifiers for replacement', () => {
    expect(component.canReplace(document('DOCUMENTS_GENERATED', {
      documentId: '',
    }) as never)).toBe(false);
    expect(component.canReplace(document('DOCUMENTS_GENERATED', {
      applicationId: '',
    }) as never)).toBe(false);
  });

  it('requires a persisted application identifier for withdrawal', () => {
    expect(component.canDelete(document('DOCUMENTS_GENERATED', {
      applicationId: '',
    }) as never)).toBe(false);
  });
});
