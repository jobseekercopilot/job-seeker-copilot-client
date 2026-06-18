# Location Gateway API Specification

This document provides a technical overview and API specification for the **Location Gateway**. It handles secure queries for official UK locations, postcodes, and regions, assisting Claimants in selecting standard geographic regions corresponding to DWP employment structures.

---

## Endpoint Specifications

### 1. Search / Autocomplete UK Locations
* **HTTP Method**: `GET`
* **Route**: `/api/locations`
* **Description**: Queries the official registry of UK cities, outward postcode sectors, and regions. Returns up to 10 records matching the query parameter for streamlined dropdown listing.
* **Query Parameters**:
  * `q` (string, required): The search keyword (searches name, outward postcode, or region).

#### Responses
* **`200 OK`**: Registry matched and results returned successfully.
  ```json
  {
    "statusCode": 200,
    "success": true,
    "message": "Retrieved 1 matching UK locations.",
    "locations": [
      {
        "id": "loc-1",
        "name": "Leeds, West Yorkshire",
        "postcode": "LS1",
        "region": "Yorkshire and the Humber"
      }
    ]
  }
  ```
* **`400 Bad Request`**: Incomplete or missing query parameter.
  ```json
  {
    "statusCode": 400,
    "success": false,
    "message": "Missing search query parameter. 'q' must be provided."
  }
  ```

---

## Pre-Loaded Regional Catalog
The gateway maintains standardized entries for key metropolitan centers:
- **Leeds, West Yorkshire** (`LS1`)
- **Manchester, Greater Manchester** (`M1`)
- **Birmingham, West Midlands** (`B1`)
- **London Central, Greater London** (`EC1A`)
- **London Enfield, Greater London** (`EN1`)
- **London Westminster, Greater London** (`SW1A`)
- **Glasgow City Centre, Scotland** (`G1`)
- **Edinburgh, Midlothian** (`EH1`)
- **Bristol City Centre, Bristol** (`BS1`)
- **Sheffield, South Yorkshire** (`S1`)
- **Cardiff City Centre, Wales** (`CF10`)
- **Newcastle-upon-Tyne, Tyne and Wear** (`NE1`)
- **Liverpool, Merseyside** (`L1`)
- **Belfast City Centre, Northern Ireland** (`BT1`)
- **Wakefield, West Yorkshire** (`WF1`)
- **York, North Yorkshire** (`YO1`)
- **Leicester, East Midlands** (`LE1`)
- **Coventry, West Midlands** (`CV1`)
- **Nottingham, East Midlands** (`NG1`)
- **Southampton, Hampshire** (`SO14`)
