# Credential validation

The account forms mirror the constraints published by the
`user-management-gateway` OpenAPI contract.

| Field | Registration | Sign in |
| --- | --- | --- |
| Name | 1–100 Unicode code points after trimming | Not collected |
| Email | 1–254 Unicode code points and a basic `local@domain` shape | Same |
| Password | 15–128 Unicode code points | 1–128 Unicode code points |

The shorter sign-in minimum is intentional: users with an existing credential
must still be able to authenticate while registration applies the current
minimum. Password values are never trimmed, normalised, lower-cased or otherwise
changed before they are submitted. Email addresses are trimmed and lower-cased;
names are trimmed.

Client validation is usability guidance, not a security boundary. The gateway
and authentication service enforce their own constraints and return
non-enumerating errors. The client:

- displays persistent guidance before submission;
- links inline field errors with `aria-describedby`;
- marks invalid fields with `aria-invalid`;
- focuses a summary after an invalid submission; and
- does not send a request when local validation fails.

Boundary tests use Unicode code points (including astral characters) and cover
minimum, maximum, malformed-email, whitespace-preservation and over-limit paths.
