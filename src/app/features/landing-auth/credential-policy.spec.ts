import {
  accountEmailError,
  loginPasswordError,
  registrationNameError,
  registrationPasswordError,
  unicodeCodePointLength,
} from './credential-policy';

describe('credential policy', () => {
  it('counts Unicode code points rather than UTF-16 code units', () => {
    expect('🌱'.length).toBe(2);
    expect(unicodeCodePointLength('🌱')).toBe(1);
  });

  it('enforces the trimmed registration-name boundaries', () => {
    expect(registrationNameError('')).not.toBeNull();
    expect(registrationNameError('🌱')).toBeNull();
    expect(registrationNameError('🌱'.repeat(100))).toBeNull();
    expect(registrationNameError('🌱'.repeat(101))).not.toBeNull();
  });

  it('enforces email shape and the 254-code-point boundary', () => {
    const maximumEmail = `${'a'.repeat(241)}@example.test`;
    const oversizedEmail = `${'a'.repeat(242)}@example.test`;

    expect(unicodeCodePointLength(maximumEmail)).toBe(254);
    expect(accountEmailError(maximumEmail)).toBeNull();
    expect(accountEmailError(oversizedEmail)).not.toBeNull();
    expect(accountEmailError('missing-at.example.test')).not.toBeNull();
    expect(accountEmailError('two@@example.test')).not.toBeNull();
    expect(accountEmailError('space @example.test')).not.toBeNull();
  });

  it('enforces registration-password boundaries without trimming', () => {
    expect(registrationPasswordError('🌱'.repeat(14))).not.toBeNull();
    expect(registrationPasswordError('🌱'.repeat(15))).toBeNull();
    expect(registrationPasswordError('🌱'.repeat(128))).toBeNull();
    expect(registrationPasswordError('🌱'.repeat(129))).not.toBeNull();
    expect(registrationPasswordError(` ${'a'.repeat(13)} `)).toBeNull();
  });

  it('permits existing login passwords from 1 through 128 code points', () => {
    expect(loginPasswordError('')).not.toBeNull();
    expect(loginPasswordError(' ')).toBeNull();
    expect(loginPasswordError('🌱'.repeat(128))).toBeNull();
    expect(loginPasswordError('🌱'.repeat(129))).not.toBeNull();
  });
});
