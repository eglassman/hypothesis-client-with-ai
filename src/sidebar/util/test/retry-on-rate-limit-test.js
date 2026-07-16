import { assert } from 'chai';
import sinon from 'sinon';

import { FetchError } from '../fetch';
import {
  isRateLimitFetchError,
  retryDelayMsFromRateLimitError,
  retryOnRateLimit,
} from '../retry-on-rate-limit';

describe('sidebar.util.retry-on-rate-limit', () => {
  describe('isRateLimitFetchError', () => {
    it('returns true for FetchError with status 429', () => {
      const err = new FetchError(
        'https://example.com',
        new Response('', { status: 429 }),
      );
      assert.isTrue(isRateLimitFetchError(err));
    });

    it('returns false for other errors', () => {
      assert.isFalse(isRateLimitFetchError(new Error('nope')));
      assert.isFalse(
        isRateLimitFetchError(
          new FetchError(
            'https://example.com',
            new Response('', { status: 500 }),
          ),
        ),
      );
    });
  });

  describe('retryDelayMsFromRateLimitError', () => {
    it('uses Retry-After seconds header', () => {
      const err = new FetchError(
        'https://example.com',
        new Response('', {
          status: 429,
          headers: { 'Retry-After': '3' },
        }),
      );
      assert.equal(retryDelayMsFromRateLimitError(err, 1), 3000);
    });

    it('falls back to linear backoff when header missing', () => {
      const err = new FetchError(
        'https://example.com',
        new Response('', { status: 429 }),
      );
      assert.equal(retryDelayMsFromRateLimitError(err, 2, 500), 1000);
    });
  });

  describe('retryOnRateLimit', () => {
    let clock;

    beforeEach(() => {
      clock = sinon.useFakeTimers();
    });

    afterEach(() => {
      clock.restore();
    });

    it('retries after 429 then succeeds', async () => {
      const fn = sinon.stub();
      fn.onCall(0).rejects(
        new FetchError(
          'https://example.com',
          new Response('', {
            status: 429,
            headers: { 'Retry-After': '1' },
          }),
        ),
      );
      fn.onCall(1).resolves('ok');

      const promise = retryOnRateLimit(fn);
      await clock.tickAsync(1000);
      assert.equal(await promise, 'ok');
      assert.equal(fn.callCount, 2);
    });

    it('does not retry non-429 errors', async () => {
      const fn = sinon.stub().rejects(new Error('boom'));
      let error;
      try {
        await retryOnRateLimit(fn);
      } catch (err) {
        error = err;
      }
      assert.instanceOf(error, Error);
      assert.equal(error.message, 'boom');
      assert.equal(fn.callCount, 1);
    });
  });
});
