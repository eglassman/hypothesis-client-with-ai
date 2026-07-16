import { usePopoverShouldClose } from '@hypothesis/frontend-shared';
import classnames from 'classnames';
import type { JSX } from 'preact';
import { useRef, useState } from 'preact/hooks';

import AutocompleteList from './AutocompleteList';

export type SearchableComboboxProps = {
  id: string;
  ariaLabel: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  allowCustomValue?: boolean;
  disabled?: boolean;
  inputClassName?: string;
  placeholder?: string;
};

/** Searchable string selector which can optionally accept values outside its options. */
export function SearchableCombobox({
  id,
  ariaLabel,
  options,
  value,
  onChange,
  allowCustomValue = false,
  disabled = false,
  inputClassName = 'h-9',
  placeholder,
}: SearchableComboboxProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(-1);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = options.filter(option =>
    option.toLocaleLowerCase().includes(normalizedQuery),
  );
  const listOpen = open && filteredOptions.length > 0;
  const listId = `${id}-listbox`;
  const optionIdPrefix = `${id}-option-`;
  const activeDescendant =
    listOpen && activeItem >= 0 ? `${optionIdPrefix}${activeItem}` : undefined;

  const closeList = () => {
    setOpen(false);
    setActiveItem(-1);
  };

  usePopoverShouldClose(wrapperRef, closeList, { enabled: open });

  const selectOption = (option: string) => {
    onChange(option);
    setQuery(option);
    closeList();
  };

  const handleKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === 'Escape') {
      closeList();
      event.preventDefault();
      return;
    }

    if (event.key === 'Tab') {
      closeList();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!filteredOptions.length) {
        return;
      }
      setOpen(true);
      setActiveItem(current => {
        if (event.key === 'ArrowDown') {
          return current >= filteredOptions.length - 1 ? 0 : current + 1;
        }
        return current <= 0 ? filteredOptions.length - 1 : current - 1;
      });
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter' && listOpen) {
      const exactMatch = filteredOptions.find(
        option =>
          option.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
      );
      const option = activeItem >= 0 ? filteredOptions[activeItem] : exactMatch;
      if (option) {
        selectOption(option);
        event.preventDefault();
      }
    }
  };

  return (
    <div className="min-w-0" ref={wrapperRef} data-testid={id}>
      <input
        id={id}
        aria-activedescendant={activeDescendant}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={listOpen}
        aria-label={ariaLabel}
        autoComplete="off"
        className={classnames(
          'w-full rounded border bg-white px-2 text-sm font-normal normal-case text-color-text',
          inputClassName,
        )}
        disabled={disabled}
        placeholder={placeholder}
        role="combobox"
        value={open ? query : value}
        onFocus={() => {
          setQuery(value);
          setActiveItem(-1);
          setOpen(true);
        }}
        onInput={event => {
          const nextQuery = event.currentTarget.value;
          setQuery(nextQuery);
          if (allowCustomValue) {
            onChange(nextQuery);
          }
          setActiveItem(-1);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
      />
      <AutocompleteList
        id={listId}
        activeItem={activeItem}
        itemPrefixId={optionIdPrefix}
        list={filteredOptions}
        open={listOpen}
        onSelectItem={selectOption}
      />
    </div>
  );
}
