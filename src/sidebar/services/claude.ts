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

const QuoteTagClassificationsSchema = z.object({
  classifications: z
    .array(
      z.object({
        quoteIndex: z
          .number()
          .int()
          .describe('Zero-based index into the input quotes array.'),
        additionalTags: z
          .array(z.string())
          .describe(
            'Tags from the provided list that apply to this quote. Empty array if none apply.',
          ),
      }),
    )
    .describe('One entry per input quote.'),
});

export type QuoteTagClassification = {
  quoteIndex: number;
  additionalTags: string[];
};

export type ClassifyQuotesForTagsRequest = {
  quotes: string[];
  /** Candidate tags to check against each quote (do not include the primary tag). */
  tags: string[];
  apiKey: string;
  signal?: AbortSignal;
};

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
    // Strip any non-ASCII characters (e.g. smart quotes, non-breaking spaces
    // pasted from a browser) — HTTP headers only allow ISO-8859-1.
    // eslint-disable-next-line no-control-regex
    this.#apiKey = apiKey.replace(/[^\x00-\x7F]/g, '').trim();
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
    const { query, documentUri, documentPdfBase64, apiKey, signal } = request;
    if (!documentPdfBase64 && !documentUri) {
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
   * For each quote, identify which of the candidate tags apply to it.
   * Used as a second step after the primary AI search to enrich returned
   * annotations with additional matching tags — without creating new quotes.
   */
  async classifyQuotesForOtherTags(
    request: ClassifyQuotesForTagsRequest,
  ): Promise<QuoteTagClassification[]> {
    const { quotes, tags, apiKey, signal } = request;
    if (!quotes.length || !tags.length) {
      return [];
    }

    const client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    });

    const tagList = tags.map(t => `- ${t}`).join('\n');
    const quoteList = quotes.map((q, i) => `[${i}] "${q}"`).join('\n');

    const startedAt = Date.now();
    try {
      const message = await client.messages.parse(
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 1000,
          system:
            'You are a tag classifier for research annotations. Given candidate tags and verbatim quotes from a research paper, identify which tags genuinely apply to each quote. Only assign a tag when the quote clearly belongs to that category. Return one entry per quote index.',
          messages: [
            {
              role: 'user',
              content: `Candidate tags:\n${tagList}\n\nQuotes:\n${quoteList}\n\nFor each quote index, list which candidate tags apply (empty array if none).`,
            },
          ],
          output_config: {
            format: zodOutputFormat(QuoteTagClassificationsSchema),
          },
        },
        signal ? { signal } : undefined,
      );

      return message.parsed_output?.classifications ?? [];
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
      console.error('[ClaudeService] classifyQuotesForOtherTags error:', {
        elapsedMs: Date.now() - startedAt,
        error,
      });
      throw error;
    }
  }
}
