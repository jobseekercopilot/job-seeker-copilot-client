# User Management Gateway API Specification

This document provides a technical overview and API specification for the **User Management Gateway**. It manages Claimant registration, authentication, and secure profile queries before persisting user accounts.

Internal architectures implement professional, robust standards suitable for integration into secure DWP systems.

---

## Architecture Overview

In this system:
1. **Frontend (Angular)** of the Jobseeker Copilot app does **not** persist any user credentials or profiles locally (no database, no permanent storage in browser memory/localStorage). It only maintains a transient, in-memory state during an active session.
2. The Frontend initiates secure HTTP request transactions directed to the **User Management Gateway**.
3. The **User Management Gateway** processes inbound network requests, performs security-guard checks, executes cryptographic hashing operations, and serves as an audit-logged boundary.

---

## Endpoint Specifications

### 1. Register / Onboard Claimant
* **HTTP Method**: `POST`
* **Route**: `/api/auth/register`
* **Description**: Verifies inbound payload constraints, computes a secure PBKDF2 hash alongside a generated unique salt, and registers a brand new claimant profile securely.

#### Request Body Schema
```json
{
  "name": "Sarah Jenkins",
  "email": "sarah.jenkins@gmail.com",
  "password": "SecurePassword123!",
  "profile": {
    "name": "Sarah Jenkins",
    "email": "sarah.jenkins@gmail.com",
    "skills": "Customer support receptionist, clerical data assistant",
    "experience": "Retail Team Member at Co-op (1 year)",
    "aspirations": "Customer support receptionist, clerical data assistant",
    "workPrefs": "Full-Time (35-40 hours) | Postcode: LS1 1UR (10 miles commute)"
  }
}
```

#### Responses
* **`201 Created`**: Registration successful.
  ```json
  {
    "statusCode": 201,
    "success": true,
    "message": "Claimant account registered securely with the User Management Gateway.",
    "user": {
      "id": "787c9f80-ee1d-4523-be99-2a95c477dcb1",
      "name": "Sarah Jenkins",
      "email": "sarah.jenkins@gmail.com",
      "profile": {
        "name": "Sarah Jenkins",
        "email": "sarah.jenkins@gmail.com",
        "skills": "Customer support receptionist, clerical data assistant",
        "experience": "Retail Team Member at Co-op (1 year)",
        "aspirations": "Customer support receptionist, clerical data assistant",
        "workPrefs": "Full-Time (35-40 hours) | Postcode: LS1 1UR (10 miles commute)"
      }
    }
  }
  ```
* **`400 Bad Request`**: Validation rules or minimum length checks failed.
  ```json
  {
    "statusCode": 400,
    "success": false,
    "message": "Invalid registration details. Full name must be at least 2 characters."
  }
  ```
* **`409 Conflict`**: Account with the given email address already exists in the registry.
  ```json
  {
    "statusCode": 409,
    "success": false,
    "message": "An account with this email already exists inside our DWP Registry."
  }
  ```

---

### 2. Login Claimant Session
* **HTTP Method**: `POST`
* **Route**: `/api/auth/login`
* **Description**: Receives user credentials, securely queries matching user registry entries, performs PBKDF2 hash validation against the existing unique salt, and signs the user in.

#### Request Body Schema
```json
{
  "email": "sarah.jenkins@gmail.com",
  "password": "SecurePassword123!"
}
```

#### Responses
* **`200 OK`**: Verification complete. Session is authorized.
  ```json
  {
    "statusCode": 200,
    "success": true,
    "message": "Credentials verified and secure handshake completed by gateway.",
    "user": {
      "id": "787c9f80-ee1d-4523-be99-2a95c477dcb1",
      "name": "Sarah Jenkins",
      "email": "sarah.jenkins@gmail.com",
      "profile": {
        "name": "Sarah Jenkins",
        "email": "sarah.jenkins@gmail.com",
        "skills": "Customer support receptionist, clerical data assistant",
        "experience": "Retail Team Member at Co-op (1 year)",
        "aspirations": "Customer support receptionist, clerical data assistant",
        "workPrefs": "Full-Time (35-40 hours) | Postcode: LS1 1UR (10 miles commute)"
      }
    }
  }
  ```
* **`400 Bad Request`**: Missing password or email parameter in login payload.
  ```json
  {
    "statusCode": 400,
    "success": false,
    "message": "Missing credentials. Both email and password must be supplied."
  }
  ```
* **`401 Unauthorized`**: Password or email mismatch.
  ```json
  {
    "statusCode": 401,
    "success": false,
    "message": "Invalid credentials. Check password or pin and try again."
  }
  ```

---

### 3. Retrieve Claimant Profile Info
* **HTTP Method**: `GET`
* **Route**: `/api/auth/profile`
* **Description**: Securely fetches the registered profile and general details for a logged-in/verified email address.
* **Query Parameters**:
  * `email` (string, required): The validated email address of the claimant.

#### Responses
* **`200 OK`**: Candidate profile found and returned successfully.
  ```json
  {
    "statusCode": 200,
    "success": true,
    "message": "User profile retrieved successfully from the gateway.",
    "user": {
      "id": "787c9f80-ee1d-4523-be99-2a95c477dcb1",
      "name": "Sarah Jenkins",
      "email": "sarah.jenkins@gmail.com",
      "profile": {
        "name": "Sarah Jenkins",
        "email": "sarah.jenkins@gmail.com",
        "skills": "Customer support receptionist, clerical data assistant",
        "experience": "Retail Team Member at Co-op (1 year)",
        "aspirations": "Customer support receptionist, clerical data assistant",
        "workPrefs": "Full-Time (35-40 hours) | Postcode: LS1 1UR (10 miles commute)"
      }
    }
  }
  ```
* **`400 Bad Request`**: Query parameter `email` was omitted or is empty.
  ```json
  {
    "statusCode": 400,
    "success": false,
    "message": "Missing query parameters. email must be supplied."
  }
  ```
* **`404 Not Found`**: Candidate email was not found in the gateway registration database.
  ```json
  {
    "statusCode": 404,
    "success": false,
    "message": "User profile could not be found or verified in registry."
  }
  ```

---

## Crypto Security Standard
1. **Hashing Algorithm**: PBKDF2 (Password-Based Key Derivation Function 2)
2. **Digest Specification**: `SHA512`
3. **Iterations Counter**: `1000`
4. **Digest Key Length**: `64` bytes
5. **Salt standard**: Generated via `crypto.randomBytes(16)` as an independent hexadecimal string for every registered claimant.
