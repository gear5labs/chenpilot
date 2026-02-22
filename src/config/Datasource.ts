import { DataSource, DataSourceOptions } from "typeorm";
import config from "./config";
import { Contact } from "../Contacts/contact.entity";
import { User } from "../Auth/user.entity";
import { AgentTool } from "../Agents/tools/agent-tool.entity";
import { PromptVersion, PromptMetric } from "../Agents/registry/PromptVersion.entity";

const isDev = config.env === "development";

const dbOptions: DataSourceOptions = {
  type: "postgres",
  host: config.db.postgres.host,
  port: Number(config.db.postgres.port), // Ensure port is a number
  username: config.db.postgres.username,
  password: config.db.postgres.password || undefined,
  database: config.db.postgres.database,
  synchronize: false,
  entities: [Contact, User, AgentTool, PromptVersion, PromptMetric],
  migrations: [isDev ? "src/migrations/**/*.ts" : "dist/migrations/**/*.js"],
  subscribers: [],
};

// if (config.db.postgres.password) {
//   dbOptions.password = config.db.postgres.password;
// }

const AppDataSource = new DataSource(dbOptions);

export default AppDataSource;
export { AppDataSource };
