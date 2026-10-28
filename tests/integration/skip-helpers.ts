/**
 * Helpers for visible test skipping when integration prerequisites unavailable
 * 
 * This ensures skipped tests appear in CI summary as "skipped" not "passed"
 */

export interface IntegrationPrerequisites {
  postgres: boolean;
  redis: boolean;
  all: boolean;
}

export function checkPrerequisites(): IntegrationPrerequisites {
  const postgres = !!process.env.DATABASE_HOST && !!process.env.DATABASE_PORT;
  const redis = !!process.env.REDIS_HOST && !!process.env.REDIS_PORT;

  return {
    postgres,
    redis,
    all: postgres && redis,
  };
}

export function describeIfIntegration(
  name: string,
  fn: () => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const prereqs = checkPrerequisites();

  if (!prereqs.all) {
    // Use describe.skip() so test framework reports as "skipped" not "passed"
    return describe.skip(`${name} (⏭️ skipped: missing services)`, fn);
  }

  return describe(name, fn);
}

export function itIfIntegration(
  name: string,
  fn: () => Promise<void> | void,
  timeout?: number,
): void {
  const prereqs = checkPrerequisites();

  if (!prereqs.all) {
    it.skip(`${name} (⏭️ requires: ${!prereqs.postgres ? 'PostgreSQL' : ''} ${!prereqs.redis ? 'Redis' : ''})`, fn, timeout);
    return;
  }

  it(name, fn, timeout);
}

export function logPrerequisiteStatus(): void {
  const prereqs = checkPrerequisites();

  if (!prereqs.postgres) {
    console.warn('⚠️ PostgreSQL not available (DATABASE_HOST not set)');
  }
  if (!prereqs.redis) {
    console.warn('⚠️ Redis not available (REDIS_HOST not set)');
  }
  if (prereqs.all) {
    console.log('✅ All integration prerequisites available');
  } else {
    console.warn('⏭️ Integration tests will be skipped');
  }
}
