import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import PdfUploadScreen from '../screens/PdfUploadScreen';
import PdfViewerScreen from '../screens/PdfViewerScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator: React.FC = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator 
        initialRouteName="PdfUpload"
        screenOptions={{
          headerShown: true,
          headerStyle: {
            backgroundColor: '#4a90e2',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
        <Stack.Screen 
          name="PdfUpload" 
          component={PdfUploadScreen}
          options={{ title: 'PDF Upload' }}
        />
        <Stack.Screen 
          name="PdfViewer" 
          component={PdfViewerScreen}
          options={{ title: 'PDF Viewer' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default AppNavigator; 