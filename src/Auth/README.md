# JWT Refresh Token Rotation Implementation

This implementation provides secure JWT authentication with refresh token rotation and revocation capabilities.

## Features

- **Access Token**: Short-lived (15 minutes) JWT for API authentication
- **Refresh Token**: Long-lived (7 days) cryptographically secure token stored in database
- **Token Rotation**: Each refresh generates a new token pair and revokes the old one
- **Token Revocation**: Support for revoking individual tokens or all user tokens
- **Security**: Detects token reuse and revokes entire token family
- **Session Management**: View and manage active sessions

## Architecture

### Components

1. **RefreshToken Entity** (`refreshToken.entity.ts`)
   - Stores refresh tokens in database
   - Tracks token lifecycle (creation, expiration, revocation)
   - Links tokens to users with cascade delete

2. **JWT Service** (`jwt.service.ts`)
   - Generates and verifies tokens
   - Implements rotation logic
   - Handles revocation and cleanup

3. **Auth Middleware** (`auth.middleware.ts`)
   - Validates access tokens on protected routes
   - Attaches user info to request object

4. **Auth Routes** (`auth.routes.ts`)
   - `/auth/login` - Login and get token pair
   - `/auth/refresh` - Rotate refresh token
   - `/auth/logout` - Revoke current token
   - `/auth/logout-all` - Revoke all user tokens
   - `/auth/sessions` - View active sessions

## Security Features

### Token Rotation

When a refresh token is used:

1. Validates the token exists and is not revoked
2. Checks expiration
3. Generates new token pair
4. Marks old token as revoked with replacement reference
5. Returns new tokens to client

### Token Reuse Detection

If a revoked token is used (indicating potential theft):

1. Detects the reuse attempt
2. Revokes all tokens for that user
3. Forces re-authentication on all devices

### Secure Token Generation

- Refresh tokens use `crypto.randomBytes(64)` for cryptographic security
- Access tokens are signed JWTs with expiration
- Separate secrets for access and refresh tokens

## Usage

### Environment Variables

Add to your `.env.local`:

```env
JWT_ACCESS_SECRET=your_secure_random_string_min_32_chars
JWT_REFRESH_SECRET=your_different_secure_random_string_min_32_chars
```

Generate secure secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Database Migration

Run the migration to create the refresh_token table:

```bash
npm run migration:run
```

### API Examples

#### 1. Login

```bash
POST /auth/login
Content-Type: application/json

{
  "name": "username"
}

Response:
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid",
      "name": "username",
      "address": "stellar_address"
    },
    "accessToken": "eyJhbGc...",
    "refreshToken": "a1b2c3...",
    "expiresIn": 900
  }
}
```

#### 2. Access Protected Route

```bash
GET /protected-route
Authorization: Bearer eyJhbGc...

Response: Protected data
```

#### 3. Refresh Token

```bash
POST /auth/refresh
Content-Type: application/json

{
  "refreshToken": "a1b2c3..."
}

Response:
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGc...",
    "refreshToken": "d4e5f6...",
    "expiresIn": 900
  }
}
```

#### 4. Logout

```bash
POST /auth/logout
Content-Type: application/json

{
  "refreshToken": "a1b2c3..."
}

Response:
{
  "success": true,
  "message": "Logged out successfully"
}
```

#### 5. Logout from All Devices

```bash
POST /auth/logout-all
Authorization: Bearer eyJhbGc...

Response:
{
  "success": true,
  "message": "Logged out from all devices successfully"
}
```

#### 6. View Active Sessions

```bash
GET /auth/sessions
Authorization: Bearer eyJhbGc...

Response:
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "uuid",
        "createdAt": "2024-01-01T00:00:00Z",
        "expiresAt": "2024-01-08T00:00:00Z"
      }
    ]
  }
}
```

## Client Implementation

### Token Storage

- Store `accessToken` in memory (not localStorage for security)
- Store `refreshToken` in httpOnly cookie or secure storage
- Never expose refresh token to JavaScript if possible

### Token Refresh Flow

```javascript
// Intercept 401 responses
axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      try {
        // Attempt to refresh token
        const { data } = await axios.post("/auth/refresh", {
          refreshToken: getStoredRefreshToken(),
        });

        // Update stored tokens
        setAccessToken(data.data.accessToken);
        setRefreshToken(data.data.refreshToken);

        // Retry original request
        error.config.headers.Authorization = `Bearer ${data.data.accessToken}`;
        return axios.request(error.config);
      } catch (refreshError) {
        // Refresh failed, redirect to login
        redirectToLogin();
      }
    }
    return Promise.reject(error);
  }
);
```

## Maintenance

### Cleanup Expired Tokens

Run periodically (e.g., daily cron job):

```typescript
import { container } from "tsyringe";
import JwtService from "./Auth/jwt.service";

const jwtService = container.resolve(JwtService);
const deletedCount = await jwtService.cleanupExpiredTokens();
console.log(`Cleaned up ${deletedCount} expired tokens`);
```

## Best Practices

1. **Use HTTPS**: Always use HTTPS in production to prevent token interception
2. **Short Access Token Lifetime**: Keep access tokens short-lived (15 minutes)
3. **Secure Refresh Token Storage**: Use httpOnly cookies or secure storage
4. **Monitor Token Reuse**: Log and alert on token reuse detection
5. **Regular Cleanup**: Schedule periodic cleanup of expired tokens
6. **Rotate Secrets**: Periodically rotate JWT secrets in production
7. **Rate Limiting**: Apply rate limiting to auth endpoints

## Protecting Routes

Use the `authenticateToken` middleware on protected routes:

```typescript
import { authenticateToken } from "./Auth/auth.middleware";

router.get("/protected", authenticateToken, async (req, res) => {
  // req.user contains { userId, name }
  const userId = req.user.userId;
  // ... handle request
});
```

## Testing

Test the implementation:

```bash
npm test -- auth
```

## Security Considerations

- Access tokens are stateless (JWT) - cannot be revoked until expiration
- Refresh tokens are stateful (database) - can be revoked immediately
- Token reuse detection prevents stolen token usage
- Cascade delete ensures tokens are removed when user is deleted
- Index on token column ensures fast lookup performance
