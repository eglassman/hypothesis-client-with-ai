import {
  Link,
  CancelIcon,
  HideIcon,
  ShowIcon,
} from '@hypothesis/frontend-shared';
import classnames from 'classnames';

const actionButtonClasses = classnames(
  // More padding for mobile users to make touch target larger
  'px-1.5 py-1 touch:p-2',
  // Rounded border to match container edges and make keyboard focus
  // ring shape conform. Turn off left side
  // border radius to maintain a straight dividing line
  'border-l rounded rounded-l-none',
  'text-grey-6 hover:text-color-text hover:bg-grey-2',
  // Emulates transitions on *Button shared component styling
  'transition-colors duration-200',
  'focus-visible-ring ring-inset',
  'disabled:opacity-50 disabled:pointer-events-none',
);

export type TagListItemProps = {
  /** If present, tag will be linked to this URL  */
  href?: string;

  /** Disable tag action buttons while a save is in flight. */
  disabled?: boolean;

  /**
   * Callback for converting this tag to a negative example. If present, a
   * mark-negative button will be rendered for the tag.
   */
  onMarkNegativeExample?: (tag: string) => void;

  /**
   * Callback for reverting a negative example tag to positive. If present, a
   * revert button will be rendered for the tag.
   */
  onRevertNegativeExample?: (tag: string) => void;

  /**
   * Callback for deleting this tag. If present, a delete button will be
   * rendered for the tag.
   */
  onRemoveTag?: (tag: string) => void;
  tag: string;
};

/**
 * Render a single annotation tag as part of a list of tags
 */
export default function TagListItem({
  disabled = false,
  href,
  onMarkNegativeExample,
  onRemoveTag,
  onRevertNegativeExample,
  tag,
}: TagListItemProps) {
  return (
    <li className="flex items-center border rounded bg-grey-0">
      <div className="grow px-1.5 py-1 touch:p-2">
        {href ? (
          <Link
            variant="text-light"
            href={href}
            lang=""
            target="_blank"
            aria-label={`Tag: ${tag}`}
            title={`View annotations with tag: ${tag}`}
            underline="none"
          >
            {tag}
          </Link>
        ) : (
          <span
            className="text-color-text-light cursor-default"
            aria-label={`Tag: ${tag}`}
            lang=""
          >
            {tag}
          </span>
        )}
      </div>
      {onMarkNegativeExample && (
        <button
          className={actionButtonClasses}
          disabled={disabled}
          onClick={() => {
            onMarkNegativeExample(tag);
          }}
          title={`Mark as negative example: ${tag}`}
          aria-label={`Mark as negative example: ${tag}`}
        >
          <HideIcon
            className="font-base w-em h-em"
            title={`Mark ${tag} as negative example`}
          />
        </button>
      )}
      {onRevertNegativeExample && (
        <button
          className={actionButtonClasses}
          disabled={disabled}
          onClick={() => {
            onRevertNegativeExample(tag);
          }}
          title={`Revert to positive example: ${tag}`}
          aria-label={`Revert to positive example: ${tag}`}
        >
          <ShowIcon
            className="font-base w-em h-em"
            title={`Revert ${tag} to positive example`}
          />
        </button>
      )}
      {onRemoveTag && (
        <button
          className={actionButtonClasses}
          disabled={disabled}
          onClick={() => {
            onRemoveTag(tag);
          }}
          title={`Remove tag: ${tag}`}
          aria-label={`Remove tag: ${tag}`}
        >
          <CancelIcon className="font-base w-em h-em" title={`Remove ${tag}`} />
        </button>
      )}
    </li>
  );
}
