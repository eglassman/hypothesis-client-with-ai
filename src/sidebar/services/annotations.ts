import type { ModerationStatus } from '@hypothesis/annotation-ui';

import { generateHexString } from '../../shared/random';
import type { AnnotationData, DocumentMetadata } from '../../types/annotator';
import type {
  APIAnnotationData,
  Annotation,
  SavedAnnotation,
} from '../../types/api';
import type { AnnotationEventType, SidebarSettings } from '../../types/config';
import { parseAccountID } from '../helpers/account-id';
import {
  retagAllPositiveSchemaTagsAsNegative,
  retagOneNegativeSchemaTagAsPositive,
  retagOnePositiveSchemaTagAsNegative,
  positiveSchemaTags,
} from '../helpers/tag-inventory-group';
import * as metadata from '../helpers/annotation-metadata';
import { hasSortableLocation } from '../helpers/annotation-metadata';
import { quoteDisplayChanged } from '../../annotator/util/merge-anchoring-selectors';
import {
  enrichPdfQuoteDisplayExact,
  hasPendingPdfLineBreakHyphens,
  preserveClientPdfQuoteDisplay,
  stripClientOnlyPdfQuoteFields,
} from '../helpers/pdf-quote-display';
import type { UserItem } from '../helpers/mention-suggestions';
import { wrapDisplayNameMentions, wrapMentions } from '../helpers/mentions';
import {
  defaultPermissions,
  isPrivate,
  permits,
  privatePermissions,
  sharedPermissions,
} from '../helpers/permissions';
import type { SidebarStore } from '../store';
import type { AnnotationActivityService } from './annotation-activity';
import type { TagInventoryGroupSyncService } from './tag-inventory-group-sync';
import type { APIService } from './api';
import type { ClaudeService } from './claude';
import type { ExperimentLogService } from './experiment-log';

export type MentionsOptions =
  | {
      mentionMode: 'username';
    }
  | {
      mentionMode: 'display-name';
      /**
       * A display-name/user-info map so that mention tags can be generated from
       * display-name mentions
       */
      usersMap: Map<string, UserItem>;
    };

/**
 * A service for creating, updating and persisting annotations both in the
 * local store and on the backend via the API.
 */
// @inject
export class AnnotationsService {
  private _activity: AnnotationActivityService;
  private _tagInventoryGroupSync: TagInventoryGroupSyncService;
  private _api: APIService;
  private _claude: ClaudeService;
  private _experimentLog: ExperimentLogService;
  private _settings: SidebarSettings;
  private _store: SidebarStore;

  constructor(
    annotationActivity: AnnotationActivityService,
    tagInventoryGroupSync: TagInventoryGroupSyncService,
    api: APIService,
    claude: ClaudeService,
    experimentLog: ExperimentLogService,
    settings: SidebarSettings,
    store: SidebarStore,
  ) {
    this._activity = annotationActivity;
    this._tagInventoryGroupSync = tagInventoryGroupSync;
    this._api = api;
    this._claude = claude;
    this._experimentLog = experimentLog;
    this._settings = settings;
    this._store = store;
  }

  /**
   * Apply changes for the given `annotation` from its draft in the store (if
   * any) and return a new object with those changes integrated.
   */
  private _applyDraftChanges(
    annotation: Annotation,
    mentionsOptions: MentionsOptions,
  ): Annotation {
    const changes: Partial<Annotation> = {};
    const draft = this._store.getDraft(annotation);
    const authority =
      parseAccountID(this._store.profile().userid)?.provider ??
      this._store.defaultAuthority();
    const mentionsEnabled = this._store.isFeatureEnabled('at_mentions');

    if (!draft) {
      return { ...annotation };
    }

    if (!mentionsEnabled) {
      changes.text = draft.text;
    } else if (mentionsOptions.mentionMode === 'username') {
      changes.text = wrapMentions(draft.text, authority);
    } else {
      changes.text = wrapDisplayNameMentions(
        draft.text,
        mentionsOptions.usersMap,
      );
    }

    changes.tags = draft.tags;
    changes.permissions = draft.isPrivate
      ? privatePermissions(annotation.user)
      : sharedPermissions(annotation.user, annotation.group);

    const target = annotation.target;
    if (target[0] && target[0].description !== draft.description) {
      const newTarget = structuredClone(target);
      newTarget[0].description = draft.description;
      changes.target = newTarget;
    }

    // Integrate changes from draft into object to be persisted
    return { ...annotation, ...changes };
  }

  /**
   * Create a new {@link Annotation} object from a set of field values.
   *
   * All fields not set in `annotationData` will be populated with default
   * values.
   */
  annotationFromData(
    annotationData: Partial<APIAnnotationData> &
      Pick<AnnotationData, 'uri' | 'target'>,
    /* istanbul ignore next */
    now: Date = new Date(),
  ): Annotation {
    const defaultPrivacy = this._store.getDefault('annotationPrivacy');
    const groupid = this._store.focusedGroupId();
    const profile = this._store.profile();

    if (!groupid) {
      throw new Error('Cannot create annotation without a group');
    }

    const userid = profile.userid;
    if (!userid) {
      throw new Error('Cannot create annotation when logged out');
    }

    const userInfo = profile.user_info;

    // We need a unique local/app identifier for this new annotation such
    // that we might look it up later in the store. It won't have an ID yet,
    // as it has not been persisted to the service.
    const $tag = `s:${generateHexString(8)}`;
    const annotation: Annotation = Object.assign(
      {
        created: now.toISOString(),
        group: groupid,
        permissions: defaultPermissions(userid, groupid, defaultPrivacy),
        tags: [],
        text: '',
        updated: now.toISOString(),
        user: userid,
        user_info: userInfo,
        $tag,
        hidden: false,
        links: {},
        document: { title: '' },
      },
      annotationData,
    );

    // Highlights are peculiar in that they always have private permissions
    if (metadata.isHighlight(annotation)) {
      annotation.permissions = privatePermissions(userid);
    }

    // Attach information about the current context (eg. LMS assignment).
    if (this._settings.annotationMetadata) {
      annotation.metadata = { ...this._settings.annotationMetadata };
    }

    return annotation;
  }

  /**
   * Populate a new annotation object from `annotation` and add it to the store.
   * Create a draft for it unless it's a highlight and clear other empty
   * drafts out of the way.
   */
  create(annotationData: Omit<AnnotationData, '$tag'>, now = new Date()) {
    const annotation = this.annotationFromData(annotationData, now);

    this._store.addAnnotations([annotation]);

    // Remove other drafts that are in the way, and their annotations (if new)
    this._store.deleteNewAndEmptyDrafts();

    // Create a draft unless it's a highlight
    if (!metadata.isHighlight(annotation)) {
      this._store.createDraft(annotation, {
        tags: annotation.tags,
        text: annotation.text,
        isPrivate: isPrivate(annotation.permissions),
        description: annotation.target[0]?.description,
      });
    }

    // NB: It may make sense to move the following code at some point to
    // the UI layer
    // Select the correct tab
    // If the annotation is of type note or annotation, make sure
    // the appropriate tab is selected. If it is of type reply, user
    // stays in the selected tab.
    if (metadata.isPageNote(annotation)) {
      this._store.selectTab('note');
    } else if (metadata.isAnnotation(annotation)) {
      this._store.selectTab('annotation');
    }

    (annotation.references || []).forEach(parent => {
      // Expand any parents of this annotation.
      this._store.setExpanded(parent, true);
    });
  }

  /**
   * Create a new empty "page note" annotation and add it to the store. If the
   * user is not logged in, open the `loginPrompt` panel instead.
   */
  createPageNote(document?: DocumentMetadata) {
    const topLevelFrame = this._store.mainFrame();
    if (!this._store.isLoggedIn()) {
      this._store.openSidebarPanel('loginPrompt');
      return;
    }
    if (!topLevelFrame) {
      return;
    }
    const pageNoteAnnotation = {
      target: [
        {
          source: topLevelFrame.uri,
        },
      ],
      uri: topLevelFrame.uri,
      document,
      tags: [],
    } satisfies Partial<AnnotationData>;
    this.create(pageNoteAnnotation);
  }

  /**
   * Delete an annotation via the API and update the store.
   * @param skipExperimentLog — set true when reject already logged (avoid duplicate delete event).
   */
  async delete(
    annotation: SavedAnnotation,
    opts?: {
      skipExperimentLog?: boolean;
      skipInventorySync?: boolean;
      deferStoreUpdate?: boolean;
    },
  ) {
    await this._api.annotation.delete({ id: annotation.id });
    this._activity.reportActivity('delete', annotation);
    if (!opts?.deferStoreUpdate) {
      this._store.removeAnnotations([annotation]);
    }
    if (!opts?.skipInventorySync) {
      void this._tagInventoryGroupSync.applyStoreAnnotationsToInventory();
    }

    if (!opts?.skipExperimentLog) {
      const tags = annotation.tags ?? [];
      const isAi =
        tags.includes('ai-pending') || tags.includes('ai-user-approved');
      if (isAi && annotation.id) {
        const schemaTag =
          tags.find(t => t !== 'ai-pending' && t !== 'ai-user-approved') ?? '';
        this._experimentLog.logAnnotationDeleted({
          annotationId: annotation.id,
          quoteText: metadata.quote(annotation) ?? '',
          schemaTag,
          documentUri: annotation.uri,
        });
      }
    }
  }

  /**
   * Flag an annotation for review by a moderator.
   */
  async flag(annotation: SavedAnnotation) {
    await this._api.annotation.flag({ id: annotation.id });
    this._activity.reportActivity('flag', annotation);
    this._store.updateFlagStatus(annotation.id, true);
  }

  /**
   * Create a reply to `annotation` by the user `userid` and add to the store.
   */
  reply(annotation: SavedAnnotation, userid: string) {
    const replyAnnotation = {
      group: annotation.group,
      permissions: !isPrivate(annotation.permissions)
        ? sharedPermissions(userid, annotation.group)
        : privatePermissions(userid),
      references: (annotation.references || []).concat(annotation.id),
      target: [{ source: annotation.target[0].source }],
      uri: annotation.uri,
      tags: [],
    };
    this.create(replyAnnotation);
  }

  /**
   * Save new (or update existing) annotation. On success,
   * the annotation's `Draft` will be removed and the annotation added
   * to the store.
   */
  async save(
    annotation: Annotation,
    mentionsOptions: MentionsOptions = { mentionMode: 'username' },
  ) {
    let saved: Promise<Annotation>;
    let eventType: AnnotationEventType;

    const annotationWithChanges = this._applyDraftChanges(
      annotation,
      mentionsOptions,
    );

    const pendingHyphens = hasPendingPdfLineBreakHyphens(annotationWithChanges);
    const hasClaudeKey = this._claude.apiKey().trim().length > 0;

    if (pendingHyphens && hasClaudeKey) {
      await enrichPdfQuoteDisplayExact(
        annotationWithChanges,
        this._claude,
      );
    }
    stripClientOnlyPdfQuoteFields(annotationWithChanges);

    const AI_PENDING = 'ai-pending';
    const AI_USER_APPROVED = 'ai-user-approved';
    const norm = (value: string) => value.trim();

    let reclassifyLog:
      | {
          reason: 'text-change' | 'schema-tag-removed';
          removedSchemaTags?: string[];
        }
      | undefined;

    if (metadata.isSaved(annotation)) {
      const preTags = annotation.tags ?? [];
      const hadAiTag =
        preTags.includes(AI_PENDING) || preTags.includes(AI_USER_APPROVED);
      if (hadAiTag) {
        const prePositive = positiveSchemaTags(preTags);
        const postPositive = positiveSchemaTags(annotationWithChanges.tags ?? []);
        const textChanged =
          norm(annotation.text ?? '') !== norm(annotationWithChanges.text ?? '');
        const removedSchemaTags = prePositive.filter(
          tag => !postPositive.includes(tag),
        );
        const schemaTagRemoved = removedSchemaTags.length > 0;

        if (textChanged || schemaTagRemoved) {
          const postTags = annotationWithChanges.tags ?? [];
          annotationWithChanges.tags = postTags.filter(
            t => t !== AI_PENDING && t !== AI_USER_APPROVED,
          );
          reclassifyLog = {
            reason: textChanged ? 'text-change' : 'schema-tag-removed',
            ...(schemaTagRemoved ? { removedSchemaTags } : {}),
          };
        }
      }
    }

    if (!metadata.isSaved(annotation)) {
      saved = this._api.annotation.create({}, annotationWithChanges);
      eventType = 'create';
    } else {
      saved = this._api.annotation.update(
        { id: annotation.id },
        annotationWithChanges,
      );
      eventType = 'update';
    }

    let savedAnnotation: Annotation;
    this._store.annotationSaveStarted(annotation);
    try {
      savedAnnotation = await saved;
      this._activity.reportActivity(eventType, savedAnnotation);
    } finally {
      this._store.annotationSaveFinished(annotation);
    }

    preserveClientPdfQuoteDisplay(savedAnnotation, annotationWithChanges);

    // Copy local/internal fields from the original annotation to the saved
    // version.
    for (const [key, value] of Object.entries(annotation)) {
      if (key.startsWith('$')) {
        const fields: Record<string, any> = savedAnnotation;
        fields[key] = value;
      }
    }

    // Clear out any pending changes (draft)
    this._store.removeDraft(annotation);

    // Add (or, in effect, update) the annotation to the store's collection
    this._store.addAnnotations([savedAnnotation]);

    if (reclassifyLog && metadata.isSaved(savedAnnotation) && savedAnnotation.id) {
      const preTags = annotation.tags ?? [];
      const schemaTag =
        positiveSchemaTags(preTags)[0] ??
        positiveSchemaTags(savedAnnotation.tags ?? [])[0] ??
        '';
      this._experimentLog.logReclassifyAsManual({
        annotationId: savedAnnotation.id,
        documentUri: savedAnnotation.uri,
        schemaTag,
        originalQuery: norm(annotation.text ?? ''),
        newText: norm(savedAnnotation.text ?? ''),
        quoteText: metadata.quote(savedAnnotation) ?? '',
        reason: reclassifyLog.reason,
        removedSchemaTags: reclassifyLog.removedSchemaTags,
      });
    }

    void this._tagInventoryGroupSync.applyStoreAnnotationsToInventory();
    return savedAnnotation;
  }

  /**
   * Change an annotation's moderation status, then update the annotation in
   * the store
   */
  async moderate(
    annotation: SavedAnnotation,
    newStatus: ModerationStatus,
  ): Promise<Annotation> {
    const tags = annotation.tags ?? [];
    const isAiPending = tags.includes('ai-pending');

    if (isAiPending && newStatus === 'APPROVED') {
      const schemaTag =
        tags.find(t => t !== 'ai-pending' && t !== 'ai-user-approved') ?? '';
      const pendingQuote = (metadata.quote(annotation) ?? '').trim();

      // If an already-approved annotation covers this same quote, merge the
      // new tag into it and delete the pending annotation rather than creating
      // a second annotation anchored to the same text.
      const existingApproved = this._store
        .savedAnnotations()
        .find(
          ann =>
            metadata.isSaved(ann) &&
            ann.id !== annotation.id &&
            ann.uri === annotation.uri &&
            (ann.tags ?? []).includes('ai-user-approved') &&
            schemaTag &&
            !(ann.tags ?? []).includes(schemaTag) &&
            (metadata.quote(ann) ?? '').trim() === pendingQuote,
        );

      if (existingApproved) {
        // Add the new schema tag to the existing approved annotation.
        const mergedTags = [...(existingApproved.tags ?? []), schemaTag];
        const updatedExisting = await this._updateAnnotationTags(
          existingApproved,
          mergedTags,
        );

        // Delete the now-redundant pending annotation from server + store.
        await this._api.annotation.delete({ id: annotation.id });
        this._store.removeAnnotations([annotation]);
        if (annotation.id) {
          this._store.removeAnnotationIdsFromTagInventoryRows([annotation.id]);
        }

        void this._tagInventoryGroupSync.applyStoreAnnotationsToInventory();

        this._experimentLog.logAccept({
          annotationId: existingApproved.id!,
          quoteText: pendingQuote,
          schemaTag,
          documentUri: existingApproved.uri,
        });

        return updatedExisting;
      }

      // No existing approved annotation covers this quote — standard approval.
      const newTags = tags.filter(t => t !== 'ai-pending');
      if (!newTags.includes('ai-user-approved')) {
        newTags.push('ai-user-approved');
      }

      let savedAnnotation = await this._api.annotation.update(
        { id: annotation.id },
        { tags: newTags },
      );

      for (const [key, value] of Object.entries(annotation)) {
        if (key.startsWith('$')) {
          const fields: Record<string, unknown> = savedAnnotation;
          fields[key] = value;
        }
      }

      if (savedAnnotation.moderation_status === undefined) {
        savedAnnotation = {
          ...savedAnnotation,
          moderation_status: 'APPROVED',
        };
      }

      this._store.addAnnotations([savedAnnotation]);
      void this._tagInventoryGroupSync.applyStoreAnnotationsToInventory();

      this._experimentLog.logAccept({
        annotationId: savedAnnotation.id!,
        quoteText: metadata.quote(savedAnnotation) ?? '',
        schemaTag,
        documentUri: savedAnnotation.uri,
      });

      return savedAnnotation;
    }

    if (isAiPending && newStatus === 'DENIED') {
      const id = annotation.id;
      if (id) {
        this._store.removeAnnotationIdsFromTagInventoryRows([id]);
      }

      this._experimentLog.logReject({
        annotationId: annotation.id!,
        quoteText: metadata.quote(annotation) ?? '',
        schemaTag:
          tags.find(t => t !== 'ai-pending' && t !== 'ai-user-approved') ?? '',
        documentUri: annotation.uri,
      });

      // Keep the annotation on the server as a negative example instead of
      // deleting it: drop `ai-pending` and the positive schema tag(s), add the
      // `{schemaTag}-neg-example` variant(s). The quote and query (text) stay.
      const newTags = retagAllPositiveSchemaTagsAsNegative(tags);

      const savedAnnotation = await this._updateAnnotationTags(
        annotation,
        newTags,
      );

      return savedAnnotation;
    }

    const savedAnnotation = await this._api.annotation.moderate(
      { id: annotation.id },
      {
        moderation_status: newStatus,
        current_moderation_status: annotation.moderation_status,
        annotation_updated: annotation.updated,
      },
    );

    // Add (or, in effect, update) the annotation to the store's collection
    this._store.addAnnotations([savedAnnotation]);
    void this._tagInventoryGroupSync.applyStoreAnnotationsToInventory();

    return savedAnnotation;
  }

  /**
   * Persist a new tag list for a saved annotation and refresh local state.
   */
  private async _updateAnnotationTags(
    annotation: SavedAnnotation,
    newTags: string[],
  ): Promise<Annotation> {
    let savedAnnotation = await this._api.annotation.update(
      { id: annotation.id },
      { tags: newTags },
    );

    for (const [key, value] of Object.entries(annotation)) {
      if (key.startsWith('$')) {
        const fields: Record<string, unknown> = savedAnnotation;
        fields[key] = value;
      }
    }

    this._store.addAnnotations([savedAnnotation]);
    void this._tagInventoryGroupSync.applyStoreAnnotationsToInventory();

    return savedAnnotation;
  }

  /**
   * Remove a single tag from a saved annotation and persist immediately.
   */
  async removeTagFromAnnotation(
    annotation: SavedAnnotation,
    tag: string,
  ): Promise<Annotation> {
    const tags = annotation.tags ?? [];
    if (!tags.includes(tag)) {
      throw new Error(`Tag not found: ${tag}`);
    }
    return this._updateAnnotationTags(
      annotation,
      tags.filter(t => t !== tag),
    );
  }

  /**
   * Convert one positive content tag to its `-neg-example` variant.
   */
  async markTagAsNegativeExample(
    annotation: SavedAnnotation,
    positiveTag: string,
  ): Promise<Annotation> {
    const newTags = retagOnePositiveSchemaTagAsNegative(
      annotation.tags ?? [],
      positiveTag,
    );
    if (!newTags) {
      throw new Error(`Cannot mark tag as negative example: ${positiveTag}`);
    }
    return this._updateAnnotationTags(annotation, newTags);
  }

  /**
   * Revert one `-neg-example` tag back to its positive schema tag name.
   */
  async revertNegativeExampleTag(
    annotation: SavedAnnotation,
    negativeTag: string,
  ): Promise<Annotation> {
    const newTags = retagOneNegativeSchemaTagAsPositive(
      annotation.tags ?? [],
      negativeTag,
    );
    if (!newTags) {
      throw new Error(`Cannot revert negative example tag: ${negativeTag}`);
    }
    return this._updateAnnotationTags(annotation, newTags);
  }

  /**
   * Fetch an annotation from the API and add or update it in the store
   */
  async loadAnnotation(id: string): Promise<Annotation> {
    const annotation = await this._api.annotation.read({ id });

    // Add or update the annotation in the store's collection
    this._store.addAnnotations([annotation]);

    return annotation;
  }

  /**
   * Persist enriched target selectors after guest anchoring when location or
   * quote display metadata changed.
   */
  persistEnrichedTargetIfChanged(
    before: Annotation,
    after: Annotation,
  ): void {
    if (!metadata.isSaved(after) || after.$orphan) {
      return;
    }

    const locationEnriched =
      !hasSortableLocation(before) && hasSortableLocation(after);
    const quoteDisplayEnriched = quoteDisplayChanged(
      before.target[0]?.selector,
      after.target[0]?.selector,
    );

    if (!locationEnriched && !quoteDisplayEnriched) {
      return;
    }

    const userid = this._store.profile().userid;
    if (!permits(after.permissions, 'update', userid)) {
      return;
    }

    void this._api.annotation
      .update({ id: after.id }, { target: after.target })
      .then(saved => {
        this._store.addAnnotations([saved]);
      })
      .catch(() => {
        // Best-effort persistence; local store merge already applied.
      });
  }
}
