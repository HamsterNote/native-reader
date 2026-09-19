import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ReaderPublicationModel } from './shared';
import type { NativeReaderProps, ReaderError, ReaderLoadState } from './types';

type ReaderChromeProps = Pick<NativeReaderProps, 'style' | 'testID'> & {
  state: ReaderLoadState;
  model?: ReaderPublicationModel;
  currentIndex: number;
  navigationError?: ReaderError;
  onPrevious(): void;
  onNext(): void;
  onNavigate(href: string): void;
  children?: ReactNode;
};

export function ReaderChrome({
  style,
  testID,
  state,
  model,
  currentIndex,
  navigationError,
  onPrevious,
  onNext,
  onNavigate,
  children,
}: ReaderChromeProps) {
  const total = model?.spine.length ?? 0;
  return (
    <View style={[styles.root, style]} testID={testID}>
      {state.status === 'idle' ? (
        <Text accessibilityRole="text">Select a local EPUB to begin.</Text>
      ) : null}
      {state.status === 'loading' ? (
        <Text accessibilityRole="text">Loading EPUB...</Text>
      ) : null}
      {state.status === 'error' ? (
        <View accessibilityRole="alert">
          <Text>{state.error.message}</Text>
          <Text>{state.error.code}</Text>
        </View>
      ) : null}
      {state.status === 'ready' ? (
        <>
          {model?.title ? (
            <Text accessibilityRole="header">{model.title}</Text>
          ) : null}
          <View style={styles.toolbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous chapter"
              disabled={currentIndex <= 0}
              onPress={onPrevious}
            >
              <Text>Previous</Text>
            </Pressable>
            <Text accessibilityLabel="Chapter position">
              Chapter {currentIndex + 1} of {total}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next chapter"
              disabled={currentIndex < 0 || currentIndex >= total - 1}
              onPress={onNext}
            >
              <Text>Next</Text>
            </Pressable>
          </View>
          {model?.toc.length ? (
            <View accessibilityLabel="Table of contents" style={styles.toc}>
              <Text accessibilityRole="header">Table of contents</Text>
              {model.toc.map((item) => (
                <Pressable
                  accessibilityRole="button"
                  key={item.id}
                  onPress={() => onNavigate(item.href)}
                  style={{ paddingLeft: item.depth * 12 }}
                >
                  <Text>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {navigationError ? (
            <Text accessibilityRole="alert">{navigationError.message}</Text>
          ) : null}
        </>
      ) : null}
      <View style={styles.viewport}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 320 },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 8,
  },
  toc: { gap: 4, maxHeight: 160, padding: 8 },
  viewport: { flex: 1, minHeight: 240 },
});
