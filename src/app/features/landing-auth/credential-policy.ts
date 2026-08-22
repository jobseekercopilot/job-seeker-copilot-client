export const credentialConstraints = {
  name: {minimum: 1, maximum: 100},
  email: {minimum: 1, maximum: 254},
  registrationPassword: {minimum: 15, maximum: 128},
  loginPassword: {minimum: 1, maximum: 128},
} as const;

const emailPattern = /^[^\s@]+@[^\s@]+$/u;

export function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function registrationNameError(value: string): string | null {
  const length = unicodeCodePointLength(value.trim());
  return length < credentialConstraints.name.minimum || length > credentialConstraints.name.maximum
    ? 'Enter a name between 1 and 100 characters.'
    : null;
}

export function accountEmailError(value: string): string | null {
  const email = value.trim();
  const length = unicodeCodePointLength(email);
  return length < credentialConstraints.email.minimum
    || length > credentialConstraints.email.maximum
    || !emailPattern.test(email)
    ? 'Enter a valid email address of no more than 254 characters.'
    : null;
}

export function registrationPasswordError(value: string): string | null {
  const length = unicodeCodePointLength(value);
  return length < credentialConstraints.registrationPassword.minimum
    || length > credentialConstraints.registrationPassword.maximum
    ? 'Use a password between 15 and 128 characters.'
    : null;
}

export function loginPasswordError(value: string): string | null {
  const length = unicodeCodePointLength(value);
  return length < credentialConstraints.loginPassword.minimum
    || length > credentialConstraints.loginPassword.maximum
    ? 'Enter your password using no more than 128 characters.'
    : null;
}
