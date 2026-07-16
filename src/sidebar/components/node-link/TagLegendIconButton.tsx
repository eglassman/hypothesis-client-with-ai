import { TagIcon } from '@hypothesis/frontend-shared';
import { useCallback } from 'preact/hooks';

import { useSidebarStore } from '../../store';
import TopBarToggleButton from '../TopBarToggleButton';

export default function TagLegendIconButton() {
  const store = useSidebarStore();
  const isOpen = store.isSidebarPanelOpen('tagLegend');

  const toggleTagLegend = useCallback(() => {
    store.toggleSidebarPanel('tagLegend');
  }, [store]);

  return (
    <TopBarToggleButton
      icon={TagIcon}
      expanded={isOpen}
      pressed={isOpen}
      onClick={toggleTagLegend}
      title="Show tag reference"
      data-testid="tag-legend-icon-button"
    />
  );
}
