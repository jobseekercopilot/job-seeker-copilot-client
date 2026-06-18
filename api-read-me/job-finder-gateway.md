# Job Finder Gateway API Specification

This document provides a technical overview and API specification for the **Job Finder Gateway**. It aggregates potential employment opportunities, aligns them against Claimant profile matrices (skills, experience, work preferences, and aspirations), and serves secure queries to client layers.

---

## Endpoint Specifications

### 1. Match Aligned Jobs via Claimant Profile
* **HTTP Method**: `POST`
* **Route**: `/api/jobs/match`
* **Description**: Accepts the active logged-in Claimant's profile. Outbound services run an alignment keyword-scoring algorithm on active vacancies and return highly tailored matches.

#### Request Body Schema
```json
{
  "name": "Sarah Jenkins",
  "email": "sarah.jenkins@gmail.com",
  "skills": "Customer support receptionist, clerical data assistant",
  "experience": "Retail Team Member at Co-op (1 year)",
  "aspirations": "Customer support receptionist, clerical data assistant",
  "workPrefs": "Full-Time (35-40 hours) | Postcode: LS1 1UR"
}
```

#### Responses
* **`200 OK`**: Target jobs synchronized and returned successfully.
  ```json
  {
    "statusCode": 200,
    "success": true,
    "message": "Dynamically connected backend services. Retrieved aligned job matching records.",
    "jobs": [
      {
        "id": "nhs-admin-gate",
        "title": "Ward Receptionist & Clinic Support",
        "company": "Leeds Teaching Hospitals NHS Trust",
        "location": "Leeds (LS1 3EX)",
        "salary": "£12.45 per hour",
        "type": "Full-Time",
        "sector": "Healthcare & Administration",
        "summary": "Deliver friendly, organized patient reception and maintain digitised administration queues.",
        "description": "Provide high-quality front-of-house customer desk representation and administrative coordinate inputting in a fast-paced clinic.",
        "requirements": [
          "MS Excel/Word basic competency",
          "Calm and empathetic telephone manner",
          "Comfortable working with high confidentiality"
        ]
      }
    ]
  }
  ```
* **`400 Bad Request`**: Incomplete or missing claimant parameters.
  ```json
  {
    "statusCode": 400,
    "success": false,
    "message": "Claimant profile must contain either skills or aspirations to query match.",
    "jobs": []
  }
  ```

---

## Technical Flow & Integration
The Angular Front-End passes claimant profile parameters to this endpoint. The Gateway queries real-time regional vacancy registries and provides filtered, scored feedback back to the UX layout automatically.
