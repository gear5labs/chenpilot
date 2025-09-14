import express from "express";
import cors from "cors";

import { authenticate } from "../Auth/auth";
import { validateQuery } from "../Agents/validationService";
import { intentAgent } from "../Agents/agents/intentagent";
const app = express();

app.use(cors());
app.use(express.json());

app.post("/query", async (req, res) => {
  const { userId, query } = req.body;

  const user = await authenticate(userId);
  if (!user) return res.status(401).json({ error: "Unauthorized" });

  const valid = await validateQuery(query);
  if (!valid) return res.status(400).json({ error: "Invalid query" });

  // 3. intent → execution
  const result = await intentAgent.handle(query, userId);

  res.json({ result });
});

export default app;
