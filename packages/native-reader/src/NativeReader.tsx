import { StyleSheet, Text, View } from 'react-native';

import type { NativeReaderProps, ReaderTheme } from './types';

const themes: Record<
  ReaderTheme,
  {
    background: string;
    foreground: string;
    muted: string;
    border: string;
    accent: string;
  }
> = {
  light: {
    background: '#ffffff',
    foreground: '#172033',
    muted: '#667085',
    border: '#d0d5dd',
    accent: '#3157a5',
  },
  dark: {
    background: '#151922',
    foreground: '#f2f4f7',
    muted: '#a4adbd',
    border: '#475467',
    accent: '#8eb1ff',
  },
  sepia: {
    background: '#f4ecd8',
    foreground: '#433422',
    muted: '#78664e',
    border: '#bca982',
    accent: '#8a5b20',
  },
};

export function NativeReader({
  content,
  initialPosition,
  theme = 'light',
  style,
  testID,
}: NativeReaderProps) {
  const token = themes[theme];
  const rawProgress = initialPosition?.progress;
  const progress = Number.isFinite(rawProgress)
    ? Math.min(1, Math.max(0, rawProgress ?? 0))
    : 0;

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: token.background, borderColor: token.border },
        style,
      ]}
      testID={testID}
    >
      <Text style={[styles.eyebrow, { color: token.accent }]}>
        Reader placeholder
      </Text>
      <Text style={[styles.title, { color: token.foreground }]}>
        {content.title}
      </Text>
      {content.placeholderText ? (
        <Text style={[styles.body, { color: token.muted }]}>
          {content.placeholderText}
        </Text>
      ) : null}
      {initialPosition?.sectionId ? (
        <Text style={[styles.detail, { color: token.foreground }]}>
          Section: {initialPosition.sectionId}
        </Text>
      ) : null}
      <Text style={[styles.detail, { color: token.foreground }]}>
        Progress: {Math.round(progress * 100)}%
      </Text>
      <Text style={[styles.detail, { color: token.muted }]}>
        Theme: {theme}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderWidth: 1, borderRadius: 20, gap: 10, padding: 24 },
  eyebrow: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 24 },
  detail: { fontSize: 14, fontWeight: '600' },
});
