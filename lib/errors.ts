/** An error whose message is safe and helpful to show the user. */
export class UserError extends Error {}

/** Resource not found or not accessible to this user. Mapped to HTTP 404. */
export class NotFoundError extends Error {}

/** Action forbidden for this user (e.g. feature disabled). Mapped to HTTP 403. */
export class ForbiddenError extends Error {}
