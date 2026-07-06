import type { Annotation } from '../../types/api';
import { PUBLIC_GROUP_ID } from '../helpers/groups';
import {
  NODE_LINK_STATE_TAG,
  NODE_LINK_STATE_TAGS,
  createNodeLinkStatePayload,
  emptyNodeLinkState,
  isNodeLinkStateAnnotation,
  nodeLinkStateUri,
  parseNodeLinkStateText,
  serializeNodeLinkState,
  stateFromNodeLinkPayload,
} from '../node-link/graph-state';
import type { NodeLinkSemanticState } from '../node-link/graph-state';
import type { APIService } from './api';

export type NodeLinkStateLoadResult = {
  status: 'loaded' | 'missing' | 'invalid';
  state: NodeLinkSemanticState;
  annotationId: string | null;
  stateUri: string;
  message?: string;
};

export type NodeLinkStateSaveResult = {
  status: 'saved';
  state: NodeLinkSemanticState;
  annotationId: string;
  stateUri: string;
  updatedAt: string;
};

const GROUP_ANNOTATIONS_PAGE_SIZE = 100;
const MAX_GROUP_ANNOTATION_PAGES = 1000;

function sharedPermissions(userid: string, groupId: string) {
  return {
    read: [`group:${groupId}`],
    update: [userid],
    delete: [userid],
  };
}

function stateDocumentTitle(groupId: string, groupName?: string) {
  return `Node Link state for ${groupName || groupId}`;
}

function isMissingOrForbidden(err: unknown) {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status?: number }).status
      : undefined;
  return status === 403 || status === 404;
}

/**
 * Load node-link semantic state from the Hypothesis API.
 *
 * Node-link runs inside the authenticated client. It uses the same
 * OAuth-backed `APIService` as annotations instead of a separate token or
 * local server.
 */
// @inject
export class NodeLinkStateService {
  private _api: APIService;

  constructor(api: APIService) {
    this._api = api;
  }

  async loadState(groupId: string): Promise<NodeLinkStateLoadResult> {
    const stateUri = nodeLinkStateUri(groupId);
    const result = await this._api.search({
      group: groupId,
      uri: stateUri,
      tag: NODE_LINK_STATE_TAG,
      limit: 10,
      sort: 'updated',
      order: 'desc',
    });
    const annotation = newestStateAnnotation(result.rows || []);

    if (!annotation) {
      return {
        status: 'missing',
        state: emptyNodeLinkState({ selectedGroupId: groupId }),
        annotationId: null,
        stateUri,
        message: 'No node-link state has been saved for this group yet.',
      };
    }

    try {
      const payload = parseNodeLinkStateText(annotation.text || '');
      return {
        status: 'loaded',
        state: stateFromNodeLinkPayload(payload, { groupId }),
        annotationId: annotation.id || null,
        stateUri,
      };
    } catch (err) {
      return {
        status: 'invalid',
        state: emptyNodeLinkState({ selectedGroupId: groupId }),
        annotationId: annotation.id || null,
        stateUri,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetchGroupAnnotations(
    groupId: string,
    signal?: AbortSignal,
    options: { uri?: string } = {},
  ): Promise<Annotation[]> {
    const annotations: Annotation[] = [];

    if (options.uri || groupId === PUBLIC_GROUP_ID) {
      if (!options.uri) {
        return annotations;
      }

      for (let page = 0; page < MAX_GROUP_ANNOTATION_PAGES; page++) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const result = await this._api.search(
          {
            group: groupId,
            uri: options.uri,
            limit: GROUP_ANNOTATIONS_PAGE_SIZE,
            offset: page * GROUP_ANNOTATIONS_PAGE_SIZE,
            sort: 'created',
            order: 'asc',
          },
          undefined,
          signal,
        );
        const pageAnnotations = result.rows || [];
        for (const annotation of pageAnnotations) {
          if (!isNodeLinkStateAnnotation(annotation)) {
            annotations.push(annotation);
          }
        }

        if (
          pageAnnotations.length < GROUP_ANNOTATIONS_PAGE_SIZE ||
          annotations.length >= (result.total || 0)
        ) {
          break;
        }
      }

      return annotations;
    }

    let pageAfter: string | undefined;

    for (let page = 0; page < MAX_GROUP_ANNOTATION_PAGES; page++) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const params: { pubid: string } & Record<string, string | number> = {
        pubid: groupId,
        'page[size]': GROUP_ANNOTATIONS_PAGE_SIZE,
      };
      if (pageAfter) {
        params['page[after]'] = pageAfter;
      }

      const result = await this._api.group.annotations.read(
        params,
        undefined,
        signal,
      );
      const pageAnnotations = result.data || [];
      for (const annotation of pageAnnotations) {
        if (!isNodeLinkStateAnnotation(annotation)) {
          annotations.push(annotation);
        }
      }

      if (pageAnnotations.length < GROUP_ANNOTATIONS_PAGE_SIZE) {
        break;
      }

      const nextCursor = pageAnnotations[pageAnnotations.length - 1]?.created;
      if (!nextCursor || nextCursor === pageAfter) {
        break;
      }
      pageAfter = nextCursor;
    }

    return annotations;
  }

  async saveState(
    groupId: string,
    state: NodeLinkSemanticState,
    options: { groupName?: string } = {},
  ): Promise<NodeLinkStateSaveResult> {
    const profile = await this._api.profile.read({});
    if (!profile.userid) {
      throw new Error('Hypothesis profile is missing a userid.');
    }

    const updatedAt = new Date().toISOString();
    const stateUri = nodeLinkStateUri(groupId);
    const payload = createNodeLinkStatePayload(state, {
      groupId,
      stateUri,
      updatedAt,
    });
    const body = {
      group: groupId,
      uri: stateUri,
      text: serializeNodeLinkState(payload),
      tags: NODE_LINK_STATE_TAGS,
      permissions: sharedPermissions(profile.userid, groupId),
      document: {
        title: stateDocumentTitle(groupId, options.groupName),
      },
      target: [
        {
          source: stateUri,
        },
      ],
    };

    const current = await this.loadState(groupId);
    let savedAnnotation: Annotation;
    if (current.annotationId) {
      try {
        savedAnnotation = await this._api.annotation.update(
          { id: current.annotationId },
          body,
        );
      } catch (err) {
        if (!isMissingOrForbidden(err)) {
          throw err;
        }
        savedAnnotation = await this._api.annotation.create({}, body);
      }
    } else {
      savedAnnotation = await this._api.annotation.create({}, body);
    }

    return {
      status: 'saved',
      state: stateFromNodeLinkPayload(payload, { groupId }),
      annotationId: savedAnnotation.id || '',
      stateUri,
      updatedAt: savedAnnotation.updated || payload.updatedAt,
    };
  }
}

function newestStateAnnotation(annotations: Annotation[]) {
  return (
    annotations
      .filter(isNodeLinkStateAnnotation)
      .sort((a, b) =>
        String(b.updated || b.created || '').localeCompare(
          String(a.updated || a.created || ''),
        ),
      )[0] || null
  );
}
