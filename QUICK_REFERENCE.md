# JWT Authentication - Quick Reference

## 🚀 Setup (One-Time)

```bash
# 1. Run migration
npm run migration:run

# 2. Restart app (JWT secrets already in .env.local)
npm run dev
```

## 🔑 API Endpoints

### Login

```bash
POST /auth/login
Body: { "name": "username" }
Returns: { accessToken, refreshToken, expiresIn }
```

### Refresh Token

```bash
POST /auth/refresh
Body: { "refreshToken": "..." }
Returns: { accessToken, refreshToken, expiresIn }
```

### Logout

```bash
POST /auth/logout
Body: { "refreshToken": "..." }
```

### Logout All Devices

```bash
POST /auth/logout-all
Headers: Authorization: Bearer <accessToken>
```

### View Sessions

```bash
GET /auth/sessions
Headers: Authorization: Bearer <accessToken>
```

## 🛡️ Protect Routes

```typescript
import { authenticateToken } from "../Auth/auth.middleware";

router.get("/protected", authenticateToken, (req, res) => {
  const userId = req.user.userId;
  // ... your code
});
```

## 🧪 Test

```bash
npm test -- jwt_refresh
```

## 🧹 Cleanup

```bash
npm run cleanup:tokens
```

## 📝 Token Lifetimes

- Access Token: 15 minutes
- Refresh Token: 7 days

## 🔐 Environment Variables

```env
JWT_ACCESS_SECRET=<32+ char secret>
JWT_REFRESH_SECRET=<32+ char secret>
```

## 📚 Full Documentation

- `src/Auth/README.md` - Detailed docs
- `JWT_IMPLEMENTATION_GUIDE.md` - Setup guide
- `ISSUE_55_SUMMARY.md` - Implementation summary
