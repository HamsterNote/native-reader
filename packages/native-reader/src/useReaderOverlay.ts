import { useLayoutEffect, type RefObject } from 'react';
import { Platform, View } from 'react-native';

export type ReaderOverlayLayer = 'closed' | 'drawer' | 'settings';

/** Keep the modal and its isolated background as siblings, including the iframe. */
export function useReaderOverlay(options: {
  layer: ReaderOverlayLayer;
  background: RefObject<View | null>;
  dialog: RefObject<View | null>;
  dismiss(): void;
  restore(layer: ReaderOverlayLayer): void;
}) {
  const { layer, background, dialog, dismiss, restore } = options;
  useLayoutEffect(() => {
    if (Platform.OS !== 'web' || layer === 'closed') return;
    const node = dialog.current as unknown as HTMLElement | null;
    const behind = background.current as unknown as HTMLElement | null;
    if (!node || !behind || typeof document === 'undefined') return;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not(:disabled),[role="button"]:not([aria-disabled="true"]),[tabindex="0"],a[href],input:not(:disabled)',
        ),
      ).filter(
        (item) => item.getClientRects().length > 0 && !item.closest('[inert]'),
      );
    const first = () => focusable()[0] ?? node;
    first().focus();
    const previousHidden = behind.getAttribute('aria-hidden');
    const previousInert = behind.inert;
    behind.inert = true;
    behind.setAttribute('aria-hidden', 'true');
    const contain = (event: FocusEvent) => {
      if (!node.contains(event.target as Node)) first().focus();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? index <= 0
          ? items.length - 1
          : index - 1
        : (index + 1) % items.length;
      event.preventDefault();
      (items[next] ?? node).focus();
    };
    document.addEventListener('focusin', contain, true);
    document.addEventListener('keydown', keydown, true);
    return () => {
      document.removeEventListener('focusin', contain, true);
      document.removeEventListener('keydown', keydown, true);
      behind.inert = previousInert;
      if (previousHidden === null) behind.removeAttribute('aria-hidden');
      else behind.setAttribute('aria-hidden', previousHidden);
      restore(layer);
    };
  }, [layer, background, dialog, dismiss, restore]);
}
