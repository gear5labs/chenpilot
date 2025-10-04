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
import vesuRoutes from "./vesu.routes";
import bitcoinRoutes from "./bitcoin.routes";

const app = express();

app.use(cors());
app.use(express.json());

// Auth routes
app.use("/auth", authRoutes);

// Vesu DeFi routes
app.use("/vesu", vesuRoutes);

// Bitcoin routes
app.use("/bitcoin", bitcoinRoutes);

app.post("/query", async (req, res) => {
  const { userId, query } = req.body;

  const user = await authenticate(userId);

  if (!user) throw new UnauthorizedError("invalid credentials");

  const valid = await validateQuery(query, userId);
  if (!valid) throw new ValidationError("invalid query");

  // Handle all commands through intent agent (including DeFi commands)
  const result = await intentAgent.handle(query, userId);
  res.json({ result });
});

app.use(ErrorHandler);

export default app;
