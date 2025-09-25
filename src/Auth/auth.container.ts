import "reflect-metadata";
import { container } from "tsyringe";
import { AuthRepository } from "./auth.repository";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { AuthMiddleware } from "./auth.middleware";

// Register dependencies
container.register("AuthRepository", {
  useClass: AuthRepository,
});

container.register("AuthService", {
  useClass: AuthService,
});

container.register("AuthController", {
  useClass: AuthController,
});

container.register("AuthMiddleware", {
  useClass: AuthMiddleware,
});

export { container };
