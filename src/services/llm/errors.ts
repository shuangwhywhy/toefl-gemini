export class SupersededError extends Error {
  constructor(message = 'Pending request was superseded by a newer request.') {
    super(message);
    this.name = 'SupersededError';
  }
}

export class ScopeCancelledError extends Error {
  constructor(message = 'Pending request was cancelled for the current scope.') {
    super(message);
    this.name = 'ScopeCancelledError';
  }
}
