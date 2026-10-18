import React from 'react';
import { Text, View } from 'react-native';
import { NativeReader } from '@hamster-note/native-reader';

export default function App() {
  // Keep the published entry point in the Android application's module graph.
  void NativeReader;
  return (
    <View>
      <Text>HNSecureWebView Android consumer</Text>
    </View>
  );
}
