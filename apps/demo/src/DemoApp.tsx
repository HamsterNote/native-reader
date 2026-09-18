import { useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import {
  NativeReader,
  type ReaderPosition,
  type ReaderTheme,
} from '@hamster-note/native-reader';

const content = {
  id: 'demo-field-notes',
  title: 'Field Notes from Hamster Valley',
  placeholderText: 'A deterministic sample for the Native Reader placeholder.',
};
const positions: Record<'beginning' | 'in-progress', ReaderPosition> = {
  beginning: { progress: 0 },
  'in-progress': { sectionId: 'Chapter 3', progress: 0.42 },
};

export function DemoApp() {
  const [theme, setTheme] = useState<ReaderTheme>('light');
  const [positionName, setPositionName] = useState<'beginning' | 'in-progress'>(
    'beginning',
  );

  return (
    <SafeAreaView style={styles.safeArea} testID="demo-root">
      <View style={styles.page}>
        <Text style={styles.heading}>Native Reader laboratory</Text>
        <Text testID="theme-state">Selected theme: {theme}</Text>
        <View
          accessibilityLabel="Reader theme"
          accessibilityRole="radiogroup"
          style={styles.controls}
        >
          {(['light', 'dark', 'sepia'] as const).map((value) => (
            <Pressable
              accessibilityLabel={`${value} theme`}
              accessibilityRole="radio"
              accessibilityState={{ selected: theme === value }}
              key={value}
              onPress={() => setTheme(value)}
              testID={`theme-${value}`}
            >
              <Text style={styles.control}>{value}</Text>
            </Pressable>
          ))}
        </View>
        <Text testID="position-state">Selected position: {positionName}</Text>
        <View
          accessibilityLabel="Reader position"
          accessibilityRole="radiogroup"
          style={styles.controls}
        >
          {(['beginning', 'in-progress'] as const).map((value) => (
            <Pressable
              accessibilityLabel={`${value} position`}
              accessibilityRole="radio"
              accessibilityState={{ selected: positionName === value }}
              key={value}
              onPress={() => setPositionName(value)}
              testID={`position-${value}`}
            >
              <Text style={styles.control}>{value}</Text>
            </Pressable>
          ))}
        </View>
        <NativeReader
          content={content}
          initialPosition={positions[positionName]}
          theme={theme}
          testID="demo-reader"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: '#e9eef7', flex: 1 },
  page: {
    alignSelf: 'center',
    gap: 14,
    maxWidth: 760,
    padding: 24,
    width: '100%',
  },
  heading: { color: '#172033', fontSize: 26, fontWeight: '800' },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  control: {
    backgroundColor: '#d5def0',
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
