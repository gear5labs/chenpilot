import express from "express";
import cors from "cors";
import { container } from "tsyringe";
import routes from "./routes";
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

app.use(cors());
app.use(express.json());
app.use(requestLogger);

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

app.use(ErrorHandler);

export default app;
