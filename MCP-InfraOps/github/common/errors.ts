export class GitHubError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly response: unknown
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

export class GitHubValidationError extends GitHubError {
  constructor(message: string, status: number, response: unknown) {
    super(message, status, response);
    this.name = "GitHubValidationError";
  }
}

export class GitHubResourceNotFoundError extends GitHubError {
  constructor(resource: string) {
    super(`Resource not found: ${resource}`, 404, { message: `${resource} not found` });
    this.name = "GitHubResourceNotFoundError";
  }
}

export class GitHubAuthenticationError extends GitHubError {
  constructor(message = "Authentication failed") {
    super(message, 401, { message });
    this.name = "GitHubAuthenticationError";
  }
}

export class GitHubPermissionError extends GitHubError {
  constructor(message = "Insufficient permissions") {
    const enhancedMessage = message.includes("Resource not accessible by personal access token")
      ? `${message}\n\nTo fix this issue:\n1. The GitHub Personal Access Token needs the 'repo' scope (or 'public_repo' for public repositories only)\n2. Go to https://github.com/settings/tokens and create/update your token with the 'repo' scope\n3. Update the GITHUB_TOKEN in your Azure Key Vault with the new token\n4. Ensure the token has write access to the repository you're trying to modify`
      : message;
    super(enhancedMessage, 403, { message });
    this.name = "GitHubPermissionError";
  }
}

export class GitHubRateLimitError extends GitHubError {
  constructor(
    message = "Rate limit exceeded",
    public readonly resetAt: Date
  ) {
    super(message, 429, { message, reset_at: resetAt.toISOString() });
    this.name = "GitHubRateLimitError";
  }
}

export class GitHubConflictError extends GitHubError {
  constructor(message: string) {
    super(message, 409, { message });
    this.name = "GitHubConflictError";
  }
}

export function isGitHubError(error: unknown): error is GitHubError {
  return error instanceof GitHubError;
}

export function createGitHubError(status: number, response: any): GitHubError {
  switch (status) {
    case 401:
      return new GitHubAuthenticationError(response?.message);
    case 403:
      return new GitHubPermissionError(response?.message);
    case 404:
      return new GitHubResourceNotFoundError(response?.message || "Resource");
    case 409:
      return new GitHubConflictError(response?.message || "Conflict occurred");
    case 422:
      return new GitHubValidationError(
        response?.message || "Validation failed",
        status,
        response
      );
    case 429:
      return new GitHubRateLimitError(
        response?.message,
        new Date(response?.reset_at || Date.now() + 60000)
      );
    default:
      return new GitHubError(
        response?.message || "GitHub API error",
        status,
        response
      );
  }
}