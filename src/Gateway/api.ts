import express from "express";
import cors from "cors";
import routes from "./routes";
import requestLogger from "../middleware/requestLogger";

import { authenticate } from "../Auth/auth";
import { validateQuery } from "../Agents/validationService";
import { intentAgent } from "../Agents/agents/intentagent";
import {
  ErrorHandler,
  UnauthorizedError,
  ValidationError,
} from "../utils/error";
const app = express();

app.use(cors());
app.use(express.json());
app.use(requestLogger);

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

app.use("/api", routes);

app.use(ErrorHandler);

export default app;
