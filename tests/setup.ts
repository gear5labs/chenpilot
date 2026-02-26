import "reflect-metadata";
import AppDataSource from "../src/config/Datasource";

beforeAll(async () => {
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
  } catch {
    // Some tests don't require database connection (e.g., middleware unit tests)
    // Silently skip database initialization if it fails
    console.log("Database initialization skipped (not required for this test)");
  }
});

afterAll(async () => {
  try {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  } catch {
    // Silently skip database cleanup if it fails
  }
});
