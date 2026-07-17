import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

const PassageSchema = z.object({
  text: z
    .string()
    .describe('Verbatim or closely paraphrased passage from the paper.'),
  section: z
    .string()
    .optional()
    .describe(
      'Section of the paper where this passage appears, if identifiable.',
    ),
});

const PassagesSchema = z.array(PassageSchema);

const PdfLineBreakHyphenDecisionSchema = z.object({
  before: z.string().describe('Text before the hyphen at the line break.'),
  after: z
    .string()
    .describe('First word on the next line after the line-break hyphen.'),
  action: z
    .enum(['drop', 'keep'])
    .describe(
      'drop = syllable hyphenation only (analy-sis → analysis); keep = lexical compound or label (Theory-based, ITEM A-ITEM B).',
    ),
});

const PdfLineBreakHyphensSchema = z.object({
  decisions: z.array(PdfLineBreakHyphenDecisionSchema),
});

export type PdfLineBreakHyphenCase = {
  before: string;
  after: string;
};

export type PdfLineBreakHyphenResolveRequest = {
  apiKey: string;
  cases: PdfLineBreakHyphenCase[];
  signal?: AbortSignal;
};

export type PdfLineBreakHyphenDecision = PdfLineBreakHyphenCase & {
  action: 'drop' | 'keep';
};

function messageFromUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return '';
}

function isNetworkTransportError(error: unknown): boolean {
  const msg = messageFromUnknownError(error);
  return /ERR_NETWORK_CHANGED|Connection error|Failed to fetch|NetworkError/i.test(
    msg,
  );
}

function isRateLimitError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    if ((error as { status?: number }).status === 429) {
      return true;
    }
  }
  return /\b429\b|rate[_ -]?limit|too many requests/i.test(
    messageFromUnknownError(error),
  );
}

/** True when Claude could not fetch the document from a URL (paywall, auth, etc.). */
export function isClaudeDocumentDownloadError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status?: number }).status;
    if (status === 400) {
      const msg = messageFromUnknownError(error);
      if (/Unable to download the file|verify the URL/i.test(msg)) {
        return true;
      }
    }
  }
  const msg = messageFromUnknownError(error);
  return /Unable to download the file|verify the URL/i.test(msg);
}

export type ClaudeSearchRequest = {
  /** Public HTTP(S) URL when Claude can fetch the document directly. */
  documentUri?: string;
  /** Base64-encoded PDF bytes when the URL is not publicly downloadable. */
  documentPdfBase64?: string;
  /** Plain text extracted from an HTML page in the browser (paywall fallback). */
  documentPlainText?: string;
  query: string;
  apiKey: string;
  /** When aborted, the request should be cancelled; callers must skip post-Claude work. */
  signal?: AbortSignal;
};

// Match the shape that AISearchPanel expects: answer.result[0].quotes
export type ClaudeSearchResult = {
  answer: { result: [{ quotes: { text: string }[] }] };
};

export class ClaudeService {
  /** User-supplied API key; session-only, in-memory (not persisted). */
  #apiKey = '';

  setApiKey(apiKey: string) {
    this.#apiKey = apiKey;
  }

  apiKey(): string {
    return this.#apiKey;
  }

  /**
   * Search a document with a free-text query using Claude's native document support.
   * Returns the quote-list shape expected by the AI search panel.
   */
  async AISearchDocument(
    request: ClaudeSearchRequest,
  ): Promise<ClaudeSearchResult> {
    const {
      query,
      documentUri,
      documentPdfBase64,
      documentPlainText,
      apiKey,
      signal,
    } = request;
    if (!documentPdfBase64 && !documentPlainText && !documentUri) {
      throw new Error('No document URL provided');
    }

    const client = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    });

    const documentBlock = documentPdfBase64
      ? ({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: documentPdfBase64,
          },
          cache_control: { type: 'ephemeral' },
        } as const)
      : documentPlainText
        ? ({
            type: 'document',
            source: {
              type: 'text',
              media_type: 'text/plain',
              data: documentPlainText,
            },
            cache_control: { type: 'ephemeral' },
          } as const)
        : ({
            type: 'document',
            source: { type: 'url', url: documentUri! },
            cache_control: { type: 'ephemeral' },
          } as const);

    const startedAt = Date.now();
    try {
      const message = await client.messages.parse(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system:
            'You return verbatim quotes from the document at hand that answers or otherwise fulfills the user query.',
          messages: [
            {
              role: 'user',
              content: [
                documentBlock as any,
                {
                  type: 'text',
                  text: query,
                },
              ],
            },
          ],
          output_config: {
            format: zodOutputFormat(PassagesSchema),
          },
        },
        signal ? { signal } : undefined,
      );

      const passages = message.parsed_output;
      if (!passages) {
        throw new Error('Claude returned no structured output');
      }

      // Keep the response shape stable for the AI search panel.
      const quotes = passages.map(p => ({ text: p.text }));
      return { answer: { result: [{ quotes }] } };
    } catch (error: unknown) {
      const aborted =
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      if (aborted) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      console.error('[ClaudeService] Error:', {
        elapsedMs: Date.now() - startedAt,
        error,
      });
      if (isNetworkTransportError(error)) {
        throw new Error(
          'Network connection changed while contacting Claude. Check your internet or VPN and try again.',
        );
      }
      if (isRateLimitError(error)) {
        throw new Error(
          'Claude rate limit exceeded. Wait a minute before running another AI search.',
        );
      }
      const details = messageFromUnknownError(error);
      if (details) {
        throw new Error(`Failed to extract quotes from document: ${details}`);
      }
      throw new Error('Failed to extract quotes from document.');
    }
  }

  /**
   * Decide whether each PDF line-break hyphen is layout-only (drop) or lexical (keep).
   */
  async resolvePdfLineBreakHyphens(
    request: PdfLineBreakHyphenResolveRequest,
  ): Promise<PdfLineBreakHyphenDecision[]> {
    const { apiKey, cases, signal } = request;
    if (cases.length === 0) {
      return [];
    }

    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    });

    const caseList = cases
      .map(
        (c, i) =>
          `${i + 1}. "${c.before}-" + "${c.after}" (hyphen between line break)`,
      )
      .join('\n');

    const message = await client.messages.parse(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: `You classify hyphens that appear at PDF line breaks in extracted text.

For each case, decide:
- "drop" when the hyphen is only syllable hyphenation split across lines (e.g. analy- + sis → analysis).
- "keep" when the hyphen is part of a lexical compound (e.g. Theory- + based → Theory-based) or a label/enumeration (e.g. ITEM A- + ITEM B).

Return one decision per input case with matching before/after strings.`,
        messages: [
          {
            role: 'user',
            content: caseList,
          },
        ],
        output_config: {
          format: zodOutputFormat(PdfLineBreakHyphensSchema),
        },
      },
      signal ? { signal } : undefined,
    );

    const parsed = message.parsed_output;
    if (!parsed?.decisions?.length) {
      throw new Error('Claude returned no hyphen decisions');
    }

    return parsed.decisions;
  }

  /**
   * Step 2: given the same few-shot prompt prefix used for the primary search
   * (with the final line replaced to ask about a specific quote), return the
   * list of other tags that apply. No document is needed — the quote is inline.
   */
  async classifyQuoteForOtherTags(request: {
    userMessage: string;
    apiKey: string;
    signal?: AbortSignal;
  }): Promise<string[]> {
    const { userMessage, apiKey, signal } = request;

    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

    const OtherTagsSchema = z.object({
      tags: z
        .array(z.string())
        .describe(
          'Tag names from the examples that clearly and confidently apply to this quote, excluding the primary tag already assigned. Return an empty array if no other tags apply — do not guess.',
        ),
    });

    const startedAt = Date.now();
    try {
      const message = await client.messages.parse(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 500,
          system:
            'Based on the annotation examples provided, identify which tags apply to the given quote. Only assign a tag if the quote clearly and confidently belongs to that category — err on the side of returning fewer tags. If no additional tags apply, return an empty array. Do not invent or guess tags.',
          messages: [{ role: 'user', content: userMessage }],
          output_config: { format: zodOutputFormat(OtherTagsSchema) },
        },
        signal ? { signal } : undefined,
      );

      return message.parsed_output?.tags ?? [];
    } catch (error: unknown) {
      const aborted =
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      if (aborted) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw error;
        }
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      console.error('[ClaudeService] classifyQuoteForOtherTags error:', {
        elapsedMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }
}
