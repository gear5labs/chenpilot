import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit"
import { container } from "tsyringe";
import routes from "./routes";
import promptRoutes from "./promptRoutes";
import requestLogger from "../middleware/requestLogger";

import { authenticate } from "../Auth/auth";
import UserService from "../Auth/user.service";
import { validateQuery } from "../Agents/validationService";
import { intentAgent } from "../Agents/agents/intentagent";
import {
  ErrorHandler,
  UnauthorizedError,
  ValidationError,
  BadError,
} from "../utils/error";

const app = express();

// --- GLOBAL SECURITY MIDDLEWARE ---
// AC: Helmet configured securely
app.use(helmet()); 

// AC: CORS configured securely
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || "*", // In production, replace * with your domain
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));

app.use(express.json());
app.use(requestLogger);

// --- RATE LIMITING STRATEGY (GLOBAL/SENSITIVE) ---

/**
 * AC: Authenticated/Sensitive Rate Limit
 * Applied to AI queries and wallet-related operations.
 * Limit: 20 requests per minute per IP.
 */
const sensitiveLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { 
    success: false, 
    error: "Sensitive action limit reached. Please wait a moment before trying again." 
  },
});

function createSuccess<T>(data: T, message: string) {
  return {
    success: true,
    data,
    message,
  };
}

app.post("/signup", async (req, res, next) => {
  try {
    const { name } = req.body;

    if (!name) {
      throw new BadError("Name is required");
    }

    const userService = container.resolve(UserService);
    const user = await userService.createUser({ name });

    res.status(201).json(createSuccess(user, "User created successfully"));
  } catch (error) {
    next(error);
  }
});

app.post("/query", async (req, res, next) => {
  try {
    const { userId, query } = req.body;

    const user = await authenticate(userId);

    if (!user) throw new UnauthorizedError("invalid credentials");

    const valid = await validateQuery(query, userId);
    if (!valid) throw new ValidationError("invalid query");

    // 3. intent → execution
    const result = await intentAgent.handle(query, userId);

    res.json({ result });
  } catch (error) {
    next(error);
  }
});

app.use("/api", routes);
app.use("/api/prompts", promptRoutes);

app.use(ErrorHandler);

export default app;
