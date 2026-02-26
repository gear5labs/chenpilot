#!/usr/bin/env ts-node

/**
 * Runner script for agent memory seeding
 */

import { seedMemoryData, verifySeededData } from "./seedAgentMemory";

try {
  console.log("Starting agent memory seeding...");
  seedMemoryData();
  
  console.log("\nVerifying seeded data...");
  const isValid = verifySeededData();
  
  if (isValid) {
    console.log("\n✓ Memory seeding completed successfully!");
    process.exit(0);
  } else {
    console.error("\n✗ Memory seeding verification failed!");
    process.exit(1);
  }
} catch (error) {
  console.error("\n✗ Seeding failed:", error);
  process.exit(1);
}
