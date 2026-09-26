import { describe, expect, it } from 'vitest';
import {
  APIError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import { classifyGenerationError } from './jobs';

const errorBody = (type: string, message: string) => ({ type: 'error', error: { type, message } });

describe('classifyGenerationError with Anthropic SDK errors', () => {
  it('treats 429 as a retryable rate limit', () => {
    const error = new RateLimitError(
      429,
      errorBody('rate_limit_error', 'Too many requests'),
      undefined,
      new Headers()
    );

    expect(classifyGenerationError(error)).toMatchObject({ kind: 'rate_limit', retryable: true });
  });

  it.each([500, 503, 529])('treats %s (including overloaded) as transient', (status) => {
    const error = APIError.generate(
      status,
      errorBody(status === 529 ? 'overloaded_error' : 'api_error', 'Overloaded'),
      undefined,
      new Headers()
    );

    expect(error).toBeInstanceOf(InternalServerError);
    expect(classifyGenerationError(error)).toMatchObject({ kind: 'transient', retryable: true });
  });

  it('treats 401 as a non-retryable authentication failure and redacts key-like text', () => {
    const error = new AuthenticationError(
      401,
      errorBody('authentication_error', 'invalid x-api-key sk-ant-api03-secret_value'),
      undefined,
      new Headers()
    );

    const classified = classifyGenerationError(error);
    expect(classified).toMatchObject({ kind: 'authentication', retryable: false });
    expect(classified.message).not.toContain('sk-ant-api03-secret_value');
  });
});
