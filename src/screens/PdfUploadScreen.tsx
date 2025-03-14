import React from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { pick, DocumentPickerResponse } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/types';

type PdfUploadScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'PdfUpload'
>;

const PdfUploadScreen: React.FC = () => {
  const navigation = useNavigation<PdfUploadScreenNavigationProp>();

  const pickPdfDocument = async () => {
    try {
      const result = await pick({
        type: ['application/pdf'],
      });
      
      if (result.length > 0) {
        handleSelectedPdf(result[0]);
      }
    } catch (err) {
      console.error('Error picking document:', err);
      Alert.alert('Error', 'Failed to pick PDF document');
    }
  };

  const handleSelectedPdf = async (document: DocumentPickerResponse) => {
    try {
      // Create app folder if it doesn't exist
      const appFolderPath = RNFS.DocumentDirectoryPath + '/pdfs';
      const exists = await RNFS.exists(appFolderPath);
      
      if (!exists) {
        await RNFS.mkdir(appFolderPath);
      }
      
      // Save the file to app's documents directory
      const destPath = `${appFolderPath}/${document.name}`;
      
      // Check if document has a valid URI
      if (!document.uri) {
        throw new Error('Document URI is undefined');
      }
      
      // Copy file from picked location to app storage
      await RNFS.copyFile(document.uri, destPath);
      
      // Navigate to the PDF viewer
      navigation.navigate('PdfViewer', { pdfPath: destPath });
    } catch (error) {
      console.error('Error saving PDF:', error);
      Alert.alert('Error', 'Failed to save PDF document');
    }
  };

  

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>OCR Text Detection</Text>
        <Text style={styles.subtitle}>Select a PDF document to begin</Text>
        
        <TouchableOpacity
          style={styles.button}
          onPress={pickPdfDocument}
        >
          <Text style={styles.buttonText}>Select PDF Document</Text>
        </TouchableOpacity>
        
        
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 32,
    color: '#666',
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#4a90e2',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    marginBottom: 16,
    width: '100%',
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#6c757d',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PdfUploadScreen; 