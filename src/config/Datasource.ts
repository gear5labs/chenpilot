import { DataSource } from "typeorm";
import config from "./config";
import { Contact } from "../Contacts/contact.entity";
import { User } from "../Auth/user.entity";

const isDev = config.env === "development";

const dbOptions: any = {
  type: "postgres",
  host: config.db.postgres.host,
  port: config.db.postgres.port,
  username: config.db.postgres.username,
  database: config.db.postgres.database,
  synchronize: false,
  entities: [Contact, User],
  migrations: [isDev ? "src/migrations/**/*.ts" : "dist/migrations/**/*.js"],
  subscribers: [],
};

if (config.db.postgres.password) {
  dbOptions.password = config.db.postgres.password;
}

const AppDataSource = new DataSource(dbOptions);

export default AppDataSource;
