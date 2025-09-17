export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
}

export function createSuccess<T = unknown>(
  data: T,
  message?: string
): SuccessResponse<T> {
  return {
    success: true,
    data,
    message,
  };
}
