# API Documentation - Transaction History Cursor Pagination

## Overview
Transaction history supports stable cursor-based pagination to handle large volumes of activity efficiently without items shifting as new transactions arrive.

## Endpoints
### Get Transaction History
`GET /api/v1/users/{userId}/transactions`

#### Query Parameters
- `limit` (integer, optional): Number of results per page (maximum 100, default 20).
- `cursor` (string, optional): Opaque base64 encoded cursor representing the point in history to resume from.

#### Error Responses
- `400 Bad Request`: Limit cannot exceed 100 or invalid cursor format.
- `404 Not Found`: User not found.
