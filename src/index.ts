import "reflect-metadata";
import http from "http";
import app from "./Gateway/api";
import config from "./config/config";
import AppDataSource from "./config/Datasource";
class Server {
  private server: http.Server;
  private port: number;

  constructor() {
    this.port = config.port || 3000;
    this.server = http.createServer(app);
  }

  public async start(): Promise<void> {
    try {
      const shutdown = async () => {
        console.log("Shutting down gracefully...");
        await AppDataSource.destroy();
        this.server.close(() => {
          console.log("Server closed");
          process.exit(0);
        });
      };
      await AppDataSource.initialize();
      console.log("db connected successfully");
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);

      this.server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          console.log(
            `Port ${this.port} in use, retrying on ${this.port + 1}...`,
          );
          this.port += 1;
          this.start();
        } else {
          console.error("Server error:", error);
          process.exit(1);
        }
      });

      this.server.listen(this.port, () => {
        console.log(`🚀 Server running on port ${this.port}`);
      });
    } catch (error) {
      console.error("Error during server startup:", error);
      process.exit(1);
    }
  }
}

(async () => {
  const server = new Server();
  await server.start();
})();
