# Testing JWT Authentication Endpoints

## Prerequisites

1. Make sure the app is running: `npm run dev`
2. Make sure you have a user created (use existing signup endpoint)
3. Database migration has been run: `npm run migration:run`

## Step-by-Step Testing

### 1. Create a User (if needed)

```bash
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{
    "name": "testuser",
    "address": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    "pk": "test_pk"
  }'
```

Expected Response:

```json
{
  "success": true,
  "userId": "uuid-here"
}
```

### 2. Login

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"name": "testuser"}'
```

Expected Response:

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "testuser",
      "address": "GXXX..."
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "a1b2c3d4e5f6...",
    "expiresIn": 900
  }
}
```

**Save the tokens for next steps!**

### 3. Test Protected Route (View Sessions)

Replace `<ACCESS_TOKEN>` with the token from step 2:

```bash
curl -X GET http://localhost:3000/auth/sessions \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Expected Response:

```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "uuid",
        "createdAt": "2024-01-01T00:00:00.000Z",
        "expiresAt": "2024-01-08T00:00:00.000Z"
      }
    ]
  }
}
```

### 4. Refresh Token

Replace `<REFRESH_TOKEN>` with the token from step 2:

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<REFRESH_TOKEN>"}'
```

Expected Response:

```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "g7h8i9j0k1l2...",
    "expiresIn": 900
  }
}
```

**Note**: The old refresh token is now revoked. Use the new one!

### 5. Try to Reuse Old Refresh Token (Should Fail)

Try using the refresh token from step 2 again:

```bash
curl -X POST http://localhost:3000/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<OLD_REFRESH_TOKEN>"}'
```

Expected Response (Error):

```json
{
  "success": false,
  "message": "Token has been revoked due to suspicious activity"
}
```

**Security Feature**: All tokens for this user are now revoked!

### 6. Logout

```bash
curl -X POST http://localhost:3000/auth/logout \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "<CURRENT_REFRESH_TOKEN>"}'
```

Expected Response:

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### 7. Logout from All Devices

First, login again to get new tokens, then:

```bash
curl -X POST http://localhost:3000/auth/logout-all \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

Expected Response:

```json
{
  "success": true,
  "message": "Logged out from all devices successfully"
}
```

## Testing with Postman

### Setup Environment Variables

1. Create a new environment in Postman
2. Add variables:
   - `baseUrl`: `http://localhost:3000`
   - `accessToken`: (will be set automatically)
   - `refreshToken`: (will be set automatically)

### Login Request

```
POST {{baseUrl}}/auth/login
Body (JSON):
{
  "name": "testuser"
}

Tests (to save tokens):
pm.environment.set("accessToken", pm.response.json().data.accessToken);
pm.environment.set("refreshToken", pm.response.json().data.refreshToken);
```

### Protected Route Request

```
GET {{baseUrl}}/auth/sessions
Headers:
Authorization: Bearer {{accessToken}}
```

### Refresh Request

```
POST {{baseUrl}}/auth/refresh
Body (JSON):
{
  "refreshToken": "{{refreshToken}}"
}

Tests (to update tokens):
pm.environment.set("accessToken", pm.response.json().data.accessToken);
pm.environment.set("refreshToken", pm.response.json().data.refreshToken);
```

## Common Issues

### "JWT secrets must be configured"

- Make sure `.env.local` has `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`
- Restart the app after adding secrets

### "User not found"

- Create a user first using the signup endpoint
- Check the username is correct

### "Invalid or expired access token"

- Access tokens expire after 15 minutes
- Use the refresh endpoint to get a new token

### "Token has been revoked"

- You tried to reuse an old refresh token
- Login again to get new tokens

### Database connection errors

- Make sure PostgreSQL is running
- Check database credentials in `.env.local`
- Run migrations: `npm run migration:run`

## Automated Testing

Run the test suite:

```bash
npm test -- jwt_refresh
```

This will test:

- Token generation
- Token verification
- Token rotation
- Token reuse detection
- Token revocation
- Session management

## Next Steps

1. Integrate with your frontend application
2. Implement automatic token refresh on 401 errors
3. Add token cleanup to cron jobs
4. Monitor logs for security events
