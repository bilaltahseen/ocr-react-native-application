# React Native PDF Viewer with OCR

A powerful mobile application that combines PDF viewing capabilities with advanced Optical Character Recognition (OCR) functionality. This app allows users to view PDF documents and extract text directly from them using machine learning.

## Features

- **PDF Viewing**: Smooth, responsive PDF viewing with page navigation
- **Text Recognition**: Extract text from PDF pages using ML Kit's OCR engine
- **Interactive Text Selection**: Tap on highlighted text blocks or individual words
- **Session Persistence**: The app remembers your last viewed page across sessions
- **Real-time Feedback**: View selected text in a scrollable panel

## How to Use

### PDF Viewing

1. Open the app and select a PDF document
2. Navigate through pages using swipe gestures or the navigation controls
3. The current page number and total pages are displayed at the top
4. When you reopen the application, it will automatically resume from your last viewed page

### Text Recognition

1. Open a PDF document
2. Navigate to the page containing text you want to extract
3. Tap the "Drawing: ON" button
4. Use your finger to draw around the text you want to extract
5. Wait for the OCR process to complete (a loading indicator will be displayed)
6. Once complete, the selected text will be highlighted on the page

### Selecting Text

1. After OCR is complete, the text inside your drawn area will be highlighted
2. The selected text will appear in a panel at the bottom of the screen
3. You can scroll through longer selections in this panel

### Page Navigation

1. Use the navigation bar at the bottom to move between pages
2. Jump to specific pages by entering the page number
3. Use the first/last page buttons to quickly navigate through long documents
4. Your last viewed page will be remembered even after closing the app

## Technical Implementation

### OCR Engine

The app uses Google's ML Kit Text Recognition API to perform OCR on PDF pages:

- The current PDF page is captured as an image
- The image is processed by ML Kit's text recognition algorithm
- The recognized text is mapped back to the screen with proper coordinate scaling

### Persistent Storage Implementation

#### Step-by-Step Guide

1. **Add Storage Dependencies**

The application uses AsyncStorage to maintain session persistence:

```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Constants for storage keys
const LAST_VIEWED_PAGE_KEY = 'LAST_VIEWED_PAGE';
const PDF_FILE_PATH_KEY = 'PDF_FILE_PATH';
```

2. **Save Page State**

A function saves the current page and PDF path whenever the user navigates to a new page:

```javascript
// Function to save the current page state
const saveCurrentPageState = async (page: number, filePath: string) => {
  try {
    await AsyncStorage.setItem(LAST_VIEWED_PAGE_KEY, page.toString());
    await AsyncStorage.setItem(PDF_FILE_PATH_KEY, filePath);
    console.log(`Saved page ${page} for PDF: ${filePath}`);
  } catch (error) {
    console.error('Error saving page state:', error);
  }
};
```

3. **Page Change Handler**

This function is called whenever the page changes and invokes the storage function:

```javascript
// Add a function to handle page changes
const handlePageChange = (page: number, noOfPages: number) => {
  console.log('handlePageChange', page);
  setCurrentPage(page);

  if (totalPages !== noOfPages) {
    setTotalPages(noOfPages);
  }
  
  // Save the current page and PDF path to AsyncStorage for persistence
  saveCurrentPageState(page, pdfPath);
};
```

4. **Load Saved Page on Start**

When the PDF viewer component mounts, it checks for previously saved state:

```javascript
// Load the last viewed page when the component mounts
useEffect(() => {
  const loadLastViewedPage = async () => {
    try {
      const savedPdfPath = await AsyncStorage.getItem(PDF_FILE_PATH_KEY);
      const lastViewedPage = await AsyncStorage.getItem(LAST_VIEWED_PAGE_KEY);
      
      // Only restore page if the PDF path matches the current one
      if (savedPdfPath === pdfPath && lastViewedPage) {
        const page = parseInt(lastViewedPage, 10);
        console.log(`Restored to page ${page} for PDF: ${pdfPath}`);
        
        // Update the current page state - the Pdf component will handle navigation
        setCurrentPage(page);
        setInitialPage(page);
      }
    } catch (error) {
      console.error('Error loading last viewed page:', error);
    }
  };

  loadLastViewedPage();
}, [pdfPath]);
```

5. **Configure PDF Component**

Set the initial page property in the PDF component to load the saved page:

```javascript
<Pdf
  source={{ uri: pdfPath }}
  page={initialPage}
  onPageChanged={handlePageChange}
  onLoadProgress={handleLoadProgress}
  onError={handlePdfError}
  style={styles.pdf}
/>
```

### Coordinate Mapping

The app includes a sophisticated coordinate mapping system that:

- Accurately scales the OCR results to match the PDF display size
- Adapts to different screen sizes and orientations
- Handles various coordinate formats returned by different ML Kit versions

### Touch Interaction

The app incorporates an advanced touch interaction system:

- Interactive SVG overlays highlight the recognized text
- Touch events are properly passed through to the correct elements
- Selection state is maintained for a smooth user experience


## Requirements

- React Native 0.63+
- @react-native-async-storage/async-storage
- @react-native-ml-kit/text-recognition
- react-native-pdf
- react-native-view-shot
- react-native-svg

## Installation

```bash
# Install dependencies
npm install

# Run on Android
npx react-native run-android

# Run on iOS
npx react-native run-ios
```

## License

[MIT License] 