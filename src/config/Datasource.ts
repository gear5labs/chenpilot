import { DataSource } from "typeorm";
import config from "./config";
import { Contact } from "../Contacts/contact.entity";
import { User } from "../Auth/user.entity";

const isDev = config.env === "development";

const AppDataSource = new DataSource({
  type: "postgres",
  host: config.db.postgres.host,
  port: config.db.postgres.port,
  username: config.db.postgres.username,
  password: config.db.postgres.password,
  database: config.db.postgres.database,
  synchronize: false,
  entities: [Contact, User],
  migrations: [isDev ? "src/migrations/**/*.ts" : "dist/migrations/**/*.js"],
  subscribers: [],
});

export default AppDataSource;
