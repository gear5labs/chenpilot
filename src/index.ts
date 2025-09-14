import http from "http";
import app from "./Gateway/api";
import config from "./config/config";
class Server {
  private server: http.Server;
  private port: number;

  constructor() {
    this.port = config.port || 3000;
    this.server = http.createServer(app);
  }

  public async start(): Promise<void> {
    try {
      const shutdown = () => {
        console.log("Shutting down gracefully...");
        this.server.close(() => {
          console.log("Server closed");
          process.exit(0);
        });
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);

      this.server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          console.log(
            `Port ${this.port} in use, retrying on ${this.port + 1}...`
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
