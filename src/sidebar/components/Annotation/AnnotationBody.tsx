import { Excerpt, MarkdownView } from '@hypothesis/annotation-ui';
import { Button, CollapseIcon, ExpandIcon } from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import { useMemo, useState } from 'preact/hooks';

import type { Annotation } from '../../../types/api';
import type { SidebarSettings } from '../../../types/config';
import { isThirdPartyUser } from '../../helpers/account-id';
import {
  canMarkTagAsNegativeExample,
  canRevertNegativeExampleTag,
  isAiPrimaryTagMarker,
} from '../../helpers/tag-inventory-group';
import type { MentionMode } from '../../helpers/mentions';
import { applyTheme } from '../../helpers/theme';
import { withServices } from '../../service-context';
import { useSidebarStore } from '../../store';
import TagList from '../TagList';
import TagListItem from '../TagListItem';

type ToggleExcerptButtonProps = {
  classes?: string;
  setCollapsed: (collapse: boolean) => void;
  collapsed: boolean;
};

/**
 * Button to expand or collapse the annotation excerpt (content)
 */
function ToggleExcerptButton({
  classes,
  setCollapsed,
  collapsed,
}: ToggleExcerptButtonProps) {
  const toggleText = collapsed ? 'More' : 'Less';
  return (
    <Button
      classes={classnames('text-grey-7 font-normal', classes)}
      expanded={!collapsed}
      onClick={() => setCollapsed(!collapsed)}
      title={`Toggle visibility of full annotation text: Show ${toggleText}`}
    >
      <div className="flex items-center gap-x-2">
        {collapsed ? (
          <ExpandIcon className="w-3 h-3" />
        ) : (
          <CollapseIcon className="w-3 h-3" />
        )}
        <div>{toggleText}</div>
      </div>
    </Button>
  );
}

export type AnnotationBodyProps = {
  annotation: Annotation;
  /** When true, tag pills show remove and mark/revert actions. */
  canEditTags?: boolean;
  tagActionsDisabled?: boolean;
  onMarkNegativeExample?: (tag: string) => void;
  onRemoveTag?: (tag: string) => void;
  onRevertNegativeExample?: (tag: string) => void;

  // injected
  settings: SidebarSettings;
};

/**
 * Display the rendered content of an annotation.
 */
function AnnotationBody({
  annotation,
  canEditTags = false,
  onMarkNegativeExample,
  onRemoveTag,
  onRevertNegativeExample,
  settings,
  tagActionsDisabled = false,
}: AnnotationBodyProps) {
  // Should the text content of `Excerpt` be rendered in a collapsed state,
  // assuming it is collapsible (exceeds allotted collapsed space)?
  const [collapsed, setCollapsed] = useState(true);

  // Does the text content of `Excerpt` take up enough vertical space that
  // collapsing/expanding is relevant?
  const [collapsible, setCollapsible] = useState(false);

  const store = useSidebarStore();
  const defaultAuthority = store.defaultAuthority();
  const draft = store.getDraft(annotation);
  const mentionsEnabled = store.isFeatureEnabled('at_mentions');

  // If there is a draft use the tag and text from it.
  // Strip internal Step-2 system markers before display.
  const tags = (draft?.tags ?? annotation.tags ?? []).filter(
    t => !isAiPrimaryTagMarker(t),
  );
  const text = draft?.text ?? annotation.text ?? '';
  const showExcerpt = text.length > 0;
  const showTagList = tags.length > 0;

  const textStyle = applyTheme(['annotationFontFamily'], settings);

  const authorIsThirdParty = useMemo(
    () => isThirdPartyUser(annotation.user, defaultAuthority),
    [annotation, defaultAuthority],
  );
  const mentionMode: MentionMode = authorIsThirdParty
    ? 'display-name'
    : 'username';

  const createTagSearchURL = (tag: string) => {
    return store.getLink('search.tag', { tag });
  };

  return (
    <div className="space-y-4">
      {showExcerpt && (
        <Excerpt
          inlineControl={false}
          collapsed={collapsed}
          collapsedHeight={400}
          onCollapsibleChanged={setCollapsible}
          onToggleCollapsed={setCollapsed}
          overflowThreshold={20}
        >
          <MarkdownView
            markdown={text}
            style={textStyle}
            mentions={annotation.mentions}
            mentionsEnabled={mentionsEnabled}
            mentionMode={mentionMode}
          />
        </Excerpt>
      )}
      {(collapsible || showTagList) && (
        <div className="flex flex-row gap-x-2">
          <div className="grow">
            {showTagList && (
              <TagList>
                {tags.map(tag => {
                  return (
                    <TagListItem
                      key={tag}
                      tag={tag}
                      disabled={tagActionsDisabled}
                      href={
                        !authorIsThirdParty
                          ? createTagSearchURL(tag)
                          : undefined
                      }
                      onRemoveTag={canEditTags ? onRemoveTag : undefined}
                      onMarkNegativeExample={
                        canEditTags &&
                        onMarkNegativeExample &&
                        canMarkTagAsNegativeExample(tags, tag)
                          ? onMarkNegativeExample
                          : undefined
                      }
                      onRevertNegativeExample={
                        canEditTags &&
                        onRevertNegativeExample &&
                        canRevertNegativeExampleTag(tags, tag)
                          ? onRevertNegativeExample
                          : undefined
                      }
                    />
                  );
                })}
              </TagList>
            )}
          </div>
          {collapsible && (
            <div>
              <ToggleExcerptButton
                classes={classnames(
                  // Pull button up toward bottom of excerpt content
                  '-mt-3',
                )}
                collapsed={collapsed}
                setCollapsed={setCollapsed}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default withServices(AnnotationBody, ['settings']);
