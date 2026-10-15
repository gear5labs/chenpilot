export interface ExecutionStep {
  id: string;
  workflowId: string;
  stepIndex: number;
  name: string;
  createdAt: Date;
}

export interface PaginationOptions {
  limit?: number;
  cursor?: string; // Format: "stepIndex_id"
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor?: string | null;
}

/**
 * Retrieves paginated execution-step history with stable, deterministic ordering.
 */
export function getPaginatedExecutionSteps(
  steps: ExecutionStep[],
  options: PaginationOptions
): PaginatedResult<ExecutionStep> {
  const limit = options.limit && options.limit > 0 ? options.limit : 20;

  // 1. Sort deterministically: primary by stepIndex (ascending), secondary by id (ascending)
  const sorted = [...steps].sort((a, b) => {
    if (a.stepIndex !== b.stepIndex) {
      return a.stepIndex - b.stepIndex;
    }
    return a.id.localeCompare(b.id);
  });

  // 2. Filter by cursor if provided
  let startIndex = 0;
  if (options.cursor) {
    const [cursorIndexStr, cursorId] = options.cursor.split('_');
    const cursorIndex = parseInt(cursorIndexStr, 10);

    startIndex = sorted.findIndex(
      (s) => s.stepIndex > cursorIndex || (s.stepIndex === cursorIndex && s.id > cursorId)
    );
    if (startIndex === -1) {
      startIndex = sorted.length;
    }
  }

  // 3. Slice the page data
  const pageData = sorted.slice(startIndex, startIndex + limit);

  // 4. Determine next cursor
  let nextCursor: string | null = null;
  if (pageData.length > 0 && startIndex + limit < sorted.length) {
    const lastItem = pageData[pageData.length - 1];
    nextCursor = `${lastItem.stepIndex}_${lastItem.id}`;
  }

  return {
    data: pageData,
    nextCursor,
  };
}