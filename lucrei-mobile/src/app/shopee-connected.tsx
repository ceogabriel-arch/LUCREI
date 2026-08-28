import { Redirect } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';

export default function ShopeeConnectedRoute() {
  useEffect(() => {
    if (Platform.OS === 'web') {
      WebBrowser.maybeCompleteAuthSession();
    }
  }, []);

  if (Platform.OS === 'web') return null;
  return <Redirect href="/" />;
}
