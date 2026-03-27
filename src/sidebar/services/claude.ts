import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';

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

export type ClaudeSearchRequest = {
  candidateURIs: string[];
  query: string;
  apiKey: string;
};

// Match the shape that AISearchPanel expects: answer.result[0].quotes
export type ClaudeSearchResult = {
  answer: { result: [{ quotes: { text: string }[] }] };
};

export class ClaudeService {
  firstPDFURI(candidateURIs: string[]): string | null {
    for (const uri of candidateURIs) {
      if (uri.toLowerCase().endsWith('.pdf')) {
        return uri;
      }
    }
    return null;
  }

  /**
   * Search a document with a free-text query using Claude's native PDF support.
   * Returns data in the same shape as ReductoService so callers don't need to change.
   */
  async AISearchDocument(
    request: ClaudeSearchRequest,
  ): Promise<ClaudeSearchResult> {
    const {query, candidateURIs, apiKey} = request;
    const documentURL = this.firstPDFURI(candidateURIs);
    if (!documentURL) {
      throw new Error('No PDF URL found in candidateURIs');
    }

    const client = new Anthropic({
      apiKey: apiKey,
      dangerouslyAllowBrowser: true,
    });

    console.log('[ClaudeService] start call', {documentURL, query});
    const startedAt = Date.now();
    try {
      const message = await client.messages.parse({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        system:
          'You return verbatim quotes from the document at hand that answers or otherwise fulfills the user query.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'document',
                source: {type: 'url', url: documentURL},
                cache_control: {type: 'ephemeral'},
              } as any,
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
      });

      console.log('[ClaudeService] success', {
        elapsedMs: Date.now() - startedAt,
      });

      const passages = message.parsed_output;
      if (!passages) {
        throw new Error('Claude returned no structured output');
      }
      console.log('[ClaudeService] parsed quotes:', passages);

      // Wrap in the Reducto-compatible shape: { result: [{ quotes: [...] }] }
      const quotes = passages.map(p => ({text: p.text}));
      return {answer: {result: [{quotes}]}};
    } catch (error) {
      console.error('[ClaudeService] Error:', {
        elapsedMs: Date.now() - startedAt,
        error,
      });
      throw new Error('Failed to extract quotes from document');
    }
  }
}