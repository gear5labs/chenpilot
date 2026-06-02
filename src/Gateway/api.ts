import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { container } from "tsyringe";
import swaggerUi from "swagger-ui-express";
import routes from "./routes";
import promptRoutes from "./promptRoutes";
import { ipBlacklistMiddleware, ipBlacklistRoutes } from "../Security";
import { authenticate } from "../Auth/auth";
import UserService from "../Auth/user.service";
import { validateQuery } from "../Agents/validationService";
import { intentAgent } from "../Agents/agents/intentagent";
import { ErrorHandler } from "./middleware/errorHandler";
import { UnauthorizedError, ValidationError, BadError } from "../utils/error";
import requestLogger from "../middleware/requestLogger";

const app = express();

// Global security middleware
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS || "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);

app.use(express.json());
app.use(requestLogger);
app.use(ipBlacklistMiddleware);

// Swagger API docs
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(require("./swagger").swaggerSpec));

// Sensitive rate limiter for AI queries
const sensitiveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error:
      "Sensitive action limit reached. Please wait a moment before trying again.",
  },
});

// Query endpoint - for AI agent queries
app.post("/query", sensitiveLimiter, async (req, res, next) => {
  try {
    const { userId, query } = req.body;
    const user = await authenticate(userId);
    if (!user) throw new UnauthorizedError("invalid credentials");

    const valid = await validateQuery(query, userId);
    if (!valid) throw new ValidationError("invalid query");

    const result = await intentAgent.handle(query, userId);
    res.json({ result });
  } catch (error) {
    next(error);
  }
});

// Mount all API routes under /api prefix
app.use("/api", routes);
app.use("/api/prompts", promptRoutes);
app.use("/api/security/blacklist", ipBlacklistRoutes);

// Global error handler
app.use(ErrorHandler);

export default app;
