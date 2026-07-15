import {
  SearchableCombobox,
  type SearchableComboboxProps,
} from '../SearchableCombobox';

export type TagComboboxProps = SearchableComboboxProps;

export function TagCombobox(props: TagComboboxProps) {
  return <SearchableCombobox {...props} />;
}
