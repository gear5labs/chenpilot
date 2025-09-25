import express from "express";
import cors from "cors";

import { authenticate } from "../Auth/auth";
import { validateQuery } from "../Agents/validationService";
import { intentAgent } from "../Agents/agents/intentagent";
import {
  ErrorHandler,
  UnauthorizedError,
  ValidationError,
} from "../utils/error";
import authRoutes from "../Auth/auth.routes";
import "../Auth/auth.container"; // Initialize DI container

const app = express();

app.use(cors());
app.use(express.json());

// Auth routes
app.use("/auth", authRoutes);

app.post("/query", async (req, res) => {
  const { userId, query } = req.body;

  const user = await authenticate(userId);

  if (!user) throw new UnauthorizedError("invalid credentials");

  const valid = await validateQuery(query, userId);
  if (!valid) throw new ValidationError("invalid query");

  // 3. intent → execution
  const result = await intentAgent.handle(query, userId);

  res.json({ result });
});

app.use(ErrorHandler);

export default app;
