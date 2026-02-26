import { DataSource, DataSourceOptions } from "typeorm";
import config from "./config";
import { Contact } from "../Contacts/contact.entity";
import { User } from "../Auth/user.entity";
import { RefreshToken } from "../Auth/refreshToken.entity";
import { AgentTool } from "../Agents/tools/agent-tool.entity";

import { WebhookIdempotency } from "../Gateway/webhookIdempotency.entity";
import { AuditLog } from "../AuditLog/auditLog.entity";

const isDev = config.env === "development";

const dbOptions: DataSourceOptions = {
  type: "postgres",
  host: config.db.postgres.host,
  port: Number(config.db.postgres.port),
  username: config.db.postgres.username,
  password: config.db.postgres.password || undefined,
  database: config.db.postgres.database,
  synchronize: false,
  entities: [
    Contact,
    User,
    RefreshToken,
    AgentTool,
    WebhookIdempotency,
    AuditLog,
  ],
  migrations: [isDev ? "src/migrations/**/*.ts" : "dist/migrations/**/*.js"],
  subscribers: [],
};

const AppDataSource = new DataSource(dbOptions);

export default AppDataSource;
export { AppDataSource };
