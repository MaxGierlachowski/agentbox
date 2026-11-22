export const isUnauthorized = (error: unknown) =>
  typeof error === "object" && error !== null && "status" in error && error.status === 401

export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Something went wrong"
