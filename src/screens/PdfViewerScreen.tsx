import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Dimensions,
  Alert,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  ActivityIndicator,
  Image,
  Modal,
  LayoutChangeEvent,
  GestureResponderEvent,
} from 'react-native';
import { RouteProp } from '@react-navigation/native';
import Pdf from 'react-native-pdf';
import { RootStackParamList } from '../navigation/types';
import Svg, { Rect, Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import TextRecognition, { TextRecognitionResult } from '@react-native-ml-kit/text-recognition';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Constants for storage keys
const LAST_VIEWED_PAGE_KEY = 'LAST_VIEWED_PAGE';
const PDF_FILE_PATH_KEY = 'PDF_FILE_PATH';

type PdfViewerScreenProps = {
  route: RouteProp<RootStackParamList, 'PdfViewer'>;
};

// Type for drawn path
type DrawPath = {
  path: string;
  page: number;
};

// Type for a point with coordinates
type Point = {
  x: number;
  y: number;
};

// Type for intersecting element
type IntersectingElement = {
  blockIndex: number;
  lineIndex: number;
  elementIndex: number;
};

const PdfViewerScreen: React.FC<PdfViewerScreenProps> = ({ route }) => {
  const { pdfPath } = route.params;
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [initialPage, setInitialPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [ocrComplete, setOcrComplete] = useState<boolean>(false);

  // Drawing state
  const [isDrawingEnabled, setIsDrawingEnabled] = useState<boolean>(false);
  const [isDrawing, setIsDrawing] = useState<boolean>(false);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [paths, setPaths] = useState<DrawPath[]>([]);

  // OCR results state
  const [ocrResult, setOcrResult] = useState<TextRecognitionResult | null>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [intersectingElements, setIntersectingElements] = useState<IntersectingElement[]>([]);

  // Track which pages have been analyzed
  const [analyzedPages, setAnalyzedPages] = useState<number[]>([]);

  // References for the PDF view
  const pdfRef = useRef(null);
  const pdfViewRef = useRef(null);
  const [pageImageUri, setPageImageUri] = useState<string | null>(null);

  // Layout dimensions for coordinate mapping
  const [viewLayout, setViewLayout] = useState({
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
    x: 0,
    y: 0,
  });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });


  // Handle view layout changes
  const handleLayoutChange = (event: LayoutChangeEvent) => {
    const { width, height, x, y } = event.nativeEvent.layout;
    setViewLayout({ width, height, x, y });
  };

  // Function to toggle drawing mode
  const toggleDrawingMode = () => {
    try {
      const newDrawingEnabled = !isDrawingEnabled;
      setIsDrawingEnabled(newDrawingEnabled);
      
      // When disabling drawing mode, make sure we clean up any in-progress drawing
      if (!newDrawingEnabled) {
        setIsDrawing(false);
        setCurrentPath('');
      }
      // If enabling drawing, always perform OCR to ensure fresh analysis
      else if (newDrawingEnabled && !isProcessing) {
        // Clear any previous results first
        setOcrResult(null);
        setSelectedText(null);
        setOcrComplete(false);
        setIntersectingElements([]);
        // Remove current page from analyzed pages to force re-analysis
        setAnalyzedPages(prev => prev.filter(page => page !== currentPage));
        // Perform OCR
        performOCR();
      }
    } catch (error) {
      console.error('Error toggling drawing mode:', error);
      // Ensure we fall back to a safe state
      setIsDrawingEnabled(false);
      setIsDrawing(false);
      setCurrentPath('');
    }
  };

  // Function to handle touch start
  const handleTouchStart = (event: GestureResponderEvent) => {
    if (!isDrawingEnabled) return;

    try {
      const { locationX, locationY } = event.nativeEvent;
      setIsDrawing(true);
      // Start a new path at the touch location
      setCurrentPath(`M ${locationX} ${locationY}`);
    } catch (error) {
      console.error('Touch start error:', error);
    }
  };

  // Function to handle touch move
  const handleTouchMove = (event: GestureResponderEvent) => {
    if (!isDrawingEnabled || !isDrawing) return;

    try {
      const { locationX, locationY } = event.nativeEvent;
      // Add line to path
      setCurrentPath(prevPath => `${prevPath} L ${locationX} ${locationY}`);
    } catch (error) {
      console.error('Touch move error:', error);
    }
  };

  // Function to handle touch end
  const handleTouchEnd = () => {
    if (!isDrawingEnabled || !isDrawing) return;

    try {
      setIsDrawing(false);

      // Only save the path if it's not empty
      if (currentPath) {
        const newPath: DrawPath = {
          path: currentPath,
          page: currentPage,
        };

        // Replace any existing paths on the current page instead of adding
        setPaths(prevPaths => {
          // Filter out paths on the current page
          const pathsOnOtherPages = prevPaths.filter(path => path.page !== currentPage);
          // Add the new path
          return [...pathsOnOtherPages, newPath];
        });

        // If OCR is complete, determine which blocks intersect with the path
        if (ocrComplete && ocrResult) {
          findIntersectingBlocks(currentPath);
        }
      }

      // Reset current path
      setCurrentPath('');
    } catch (error) {
      console.error('Touch end error:', error);
      setIsDrawing(false);
      setCurrentPath('');
    }
  };

  // Parse SVG path string into points
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const parseSvgPath = (pathString: string): Point[] => {
    const points: Point[] = [];
    const parts = pathString.trim().split(/[\s,]+/);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // M is moveto, L is lineto - both are followed by x,y coordinates
      if (part === 'M' || part === 'L') {
        if (i + 2 < parts.length) {
          const x = parseFloat(parts[i + 1]);
          const y = parseFloat(parts[i + 2]);

          if (!isNaN(x) && !isNaN(y)) {
            points.push({ x, y });
          }

          i += 2; // Skip the coordinates we just processed
        }
      }
    }

    return points;
  };

  // Check if a point is inside a polygon path
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const isPointInPath = (point: Point, pathString: string): boolean => {
    // Parse the path string to extract all points
    const pathPoints = parseSvgPath(pathString);

    if (pathPoints.length < 3) {
      return false; // Need at least 3 points to form a polygon
    }

    let inside = false;
    for (let i = 0, j = pathPoints.length - 1; i < pathPoints.length; j = i++) {
      const xi = pathPoints[i].x, yi = pathPoints[i].y;
      const xj = pathPoints[j].x, yj = pathPoints[j].y;

      const intersect = ((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  };

  // Map OCR coordinates to view coordinates
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const mapCoordinates = (x: number, y: number, width: number, height: number) => {
    // Calculate scale factors between the OCR image and the view
    const scaleX = viewLayout.width / imageSize.width;
    const scaleY = viewLayout.height / imageSize.height;

    // Apply scaling and offset
    return {
      x: x * scaleX,
      y: y * scaleY,
      width: width * scaleX,
      height: height * scaleY,
    };
  };

  // Find words that intersect with the drawn path
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const findIntersectingBlocks = useCallback((pathString: string) => {
    if (!ocrResult) return;

    const elements: IntersectingElement[] = [];
    const blockIndices: number[] = []; // Temporary array to track block indices for fallback

    ocrResult.blocks.forEach((block, blockIndex) => {
      if (block.frame) {
        const frame = block.frame as any;
        const x = frame.left || frame.x || 0;
        const y = frame.top || frame.y || 0;
        const width = frame.width || (frame.right ? frame.right - x : 0);
        const height = frame.height || (frame.bottom ? frame.bottom - y : 0);

        // Map coordinates from OCR space to view space
        const mappedCoords = mapCoordinates(x, y, width, height);

        // Check if any corner of the block is inside the path
        const corners = [
          { x: mappedCoords.x, y: mappedCoords.y }, // Top-left
          { x: mappedCoords.x + mappedCoords.width, y: mappedCoords.y }, // Top-right
          { x: mappedCoords.x, y: mappedCoords.y + mappedCoords.height }, // Bottom-left
          { x: mappedCoords.x + mappedCoords.width, y: mappedCoords.y + mappedCoords.height }, // Bottom-right
        ];

        // Check center point too
        corners.push({
          x: mappedCoords.x + mappedCoords.width / 2,
          y: mappedCoords.y + mappedCoords.height / 2
        });

        // If any corner is inside the path, consider the block as intersecting
        let blockIntersects = false;
        for (const corner of corners) {
          if (isPointInPath(corner, pathString)) {
            blockIndices.push(blockIndex);
            blockIntersects = true;
            break;
          }
        }

        // If the block intersects, check individual words within it
        if (blockIntersects) {
          block.lines?.forEach((line, lineIndex) => {
            line.elements?.forEach((element, elementIndex) => {
              if (element.frame) {
                const eFrame = element.frame as any;
                const ex = eFrame.left || eFrame.x || 0;
                const ey = eFrame.top || eFrame.y || 0;
                const ewidth = eFrame.width || (eFrame.right ? eFrame.right - ex : 0);
                const eheight = eFrame.height || (eFrame.bottom ? eFrame.bottom - ey : 0);

                // Map coordinates from OCR space to view space
                const eMappedCoords = mapCoordinates(ex, ey, ewidth, eheight);

                // Check if any corner of the word is inside the path
                const eCorners = [
                  { x: eMappedCoords.x, y: eMappedCoords.y }, // Top-left
                  { x: eMappedCoords.x + eMappedCoords.width, y: eMappedCoords.y }, // Top-right
                  { x: eMappedCoords.x, y: eMappedCoords.y + eMappedCoords.height }, // Bottom-left
                  { x: eMappedCoords.x + eMappedCoords.width, y: eMappedCoords.y + eMappedCoords.height }, // Bottom-right
                  { x: eMappedCoords.x + eMappedCoords.width / 2, y: eMappedCoords.y + eMappedCoords.height / 2 } // Center
                ];

                for (const corner of eCorners) {
                  if (isPointInPath(corner, pathString)) {
                    elements.push({ blockIndex, lineIndex, elementIndex });
                    break;
                  }
                }
              }
            });
          });
        }
      }
    });

    setIntersectingElements(elements);

    // If we have intersecting elements (words), only display those
    if (elements.length > 0) {
      // Extract just the selected words
      const selectedWords = elements.map(({ blockIndex, lineIndex, elementIndex }) => {
        return ocrResult.blocks[blockIndex].lines?.[lineIndex].elements?.[elementIndex].text || "";
      }).filter(text => text.length > 0);

      // Join the words with spaces
      if (selectedWords.length > 0) {
        setSelectedText(selectedWords.join(" "));
      }
    } else if (blockIndices.length > 0) {
      // Fallback to blocks if no specific words were found
      const blockText = ocrResult.blocks[blockIndices[0]].text;
      setSelectedText(blockText);
    }
  }, [ocrResult, isPointInPath, mapCoordinates]);

  // Function to perform OCR on current page, wrapped in useCallback
  const performOCR = useCallback(async () => {
    // If this page has already been analyzed and we're not forcing a re-analysis, don't do it again
    if (analyzedPages.includes(currentPage) && !isDrawingEnabled) {
      return;
    }

    // Prevent multiple OCR processes running simultaneously
    if (isProcessing) {
      console.log('OCR already in progress, skipping');
      return;
    }

    try {
      setIsProcessing(true);
      setOcrResult(null);
      setSelectedText(null);
      setOcrComplete(false);
      setIntersectingElements([]);

      // Capture the PDF view as an image
      if (!pdfViewRef.current) {
        throw new Error("PDF view reference is not available");
      }

      // Add a small delay to ensure the view is fully rendered
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Capture the full page image
      const fullImageUri = await captureRef(pdfViewRef, {
        format: 'jpg',
        quality: 1.0,
        result: 'tmpfile',
      });

      console.log('Full page image captured at:', fullImageUri);
      setPageImageUri(fullImageUri);

      // Get image dimensions for proper scaling
      await new Promise((resolve, reject) => {
        Image.getSize(
          fullImageUri, 
          (width, height) => {
            console.log(`Original image dimensions: ${width}x${height}`);
            setImageSize({ width, height });
            resolve(null);
          },
          (error) => {
            console.error('Failed to get image size:', error);
            reject(error);
          }
        );
      });

      // Process the image with ML Kit text recognition
      console.log('Starting text recognition on full page...');

      // Send the full image to ML Kit
      const result = await TextRecognition.recognize(fullImageUri);
      
      // Check if component is still mounted and in the same state
      // This helps prevent state updates on unmounted components
      
      console.log('Recognition result:', JSON.stringify(result, null, 2));

      if (result) {
        setOcrResult(result);
        // Mark this page as analyzed
        setAnalyzedPages(prev => [...prev, currentPage]);
        console.log(`OCR complete: Found ${result.blocks.length} text blocks`);

        // Check if there are any existing paths to process
        const pathsOnCurrentPage = paths.filter(path => path.page === currentPage);
        if (pathsOnCurrentPage.length > 0) {
          // Process the latest path to find intersecting blocks
          findIntersectingBlocks(pathsOnCurrentPage[pathsOnCurrentPage.length - 1].path);
        }

        if (result.blocks.length === 0) {
          Alert.alert("OCR Complete", "No text was detected on this page. Try another page or check if the PDF contains actual text rather than images of text.");
        }
      } else {
        Alert.alert("OCR Failed", "The text recognition process failed. Please try again.");
      }
    } catch (error) {
      console.error('OCR Error:', error);
      Alert.alert("OCR Error", `Error performing OCR: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsProcessing(false);
      setOcrComplete(true);
    }
  }, [currentPage, analyzedPages, paths, pdfViewRef, findIntersectingBlocks, isDrawingEnabled, isProcessing]);

  // Check if page needs analysis when it changes or after component mounts
  useEffect(() => {
    // If drawing is enabled and the current page hasn't been analyzed, perform OCR
    if (isDrawingEnabled && !analyzedPages.includes(currentPage) && !isProcessing && totalPages > 0) {
      performOCR();
    }
  }, [currentPage, totalPages, isDrawingEnabled, analyzedPages, isProcessing, performOCR]);

  // Function to handle block/word selection
  const handleTextSelection = (text: string) => {
    setSelectedText(text);
  };

  // Clear OCR results and drawings
  const clearAll = () => {
    setOcrResult(null);
    setSelectedText(null);
    setOcrComplete(false);
    setPageImageUri(null);
    setPaths([]);
    setCurrentPath('');
    setIntersectingElements([]);
    // Remove current page from analyzed pages to allow re-analysis
    setAnalyzedPages(prev => prev.filter(page => page !== currentPage));
  };

  // Add a function to clear just the current drawing
  const clearCurrentDrawing = () => {
    // Keep paths on other pages, remove paths on current page
    setPaths(prevPaths => prevPaths.filter(path => path.page !== currentPage));
    setCurrentPath('');
    // Clear highlighted elements if drawing was cleared
    setIntersectingElements([]);
    setSelectedText(null);
  };

  // Add a function to handle closing the text panel
  const handleCloseTextPanel = () => {
    setSelectedText(null);
    setPaths([]); // Clear all drawings
    setIntersectingElements([]); // Clear highlighted elements
  };

  // Add a function to handle page changes
  const handlePageChange = (page: number,noOfPages:number) => {
    console.log('handlePageChange', page);
    setCurrentPage(page);

    if (totalPages !== noOfPages) {
      setTotalPages(noOfPages);
    }
    
    // Save the current page and PDF path to AsyncStorage for persistence
    saveCurrentPageState(page, pdfPath);
  };

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

  // Add a function to handle the PDF view error
  const handlePdfError = (error: any) => {
    console.error('Error loading PDF:', error);
    Alert.alert('Error', 'Failed to load PDF document');
  };

  // Add a function to handle the PDF view load progress
  const handleLoadProgress = (progress: number) => {
    console.log('handleLoadProgress', progress);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.pageInfo}>
          Page {currentPage} of {totalPages}
        </Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={[
              styles.drawingToggleButton,
              isDrawingEnabled ? styles.activeButton : styles.inactiveButton
            ]}
            onPress={toggleDrawingMode}
          >
            <Text style={isDrawingEnabled ? styles.activeButtonText : styles.inactiveButtonText}>
              {isDrawingEnabled ? "Drawing: ON" : "Drawing: OFF"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.pdfContainer} ref={pdfRef}>
        {/* PDF Viewer */}
        <View
          ref={pdfViewRef}
          style={styles.pdfView}
          collapsable={false}
          onLayout={handleLayoutChange}
        >
          <Pdf
            source={{ uri: pdfPath }}
            page={initialPage}
            onPageChanged={handlePageChange}
            onLoadProgress={handleLoadProgress}
            onError={handlePdfError}
            style={styles.pdf}
          />
        </View>

        {/* Drawing and OCR Overlay - Only show when drawing is enabled */}
        {isDrawingEnabled && (
          <View 
            style={styles.ocrOverlay} 
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            pointerEvents="auto"
          >
            <Svg height="100%" width="100%">
              {/* Render current drawing path */}
              {isDrawing && currentPath && (
                <Path
                  d={currentPath}
                  stroke="red"
                  strokeWidth={3}
                  fill="transparent"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              )}
              
              {/* Render saved paths */}
              {paths
                .filter(path => path.page === currentPage)
                .map((path, index) => (
                  <Path
                    key={`path-${index}`}
                    d={path.path}
                    stroke="red"
                    strokeWidth={3}
                    fill="rgba(255, 0, 0, 0.1)"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                ))}
              
              {/* Render text blocks that intersect with drawing */}
              {ocrResult && ocrComplete && imageSize.width > 0 && (
                <>
                  {/* Render only specific words that intersect with drawing */}
                  {intersectingElements.length > 0 && intersectingElements.map((elem, index) => {
                    const { blockIndex, lineIndex, elementIndex } = elem;
                    const element = ocrResult.blocks[blockIndex]?.lines?.[lineIndex]?.elements?.[elementIndex];
                    
                    // Only render if element and frame data are available
                    if (element && element.frame) {
                      // Calculate frame dimensions from the frame object
                      const frame = element.frame as any;
                      let x = frame.left || frame.x || 0;
                      let y = frame.top || frame.y || 0;
                      let width = frame.width || (frame.right ? frame.right - x : 0);
                      let height = frame.height || (frame.bottom ? frame.bottom - y : 0);
                      
                      // Map OCR coordinates to view coordinates
                      const mappedCoords = mapCoordinates(x, y, width, height);
                      
                      return (
                        <Rect
                          key={`selected-element-${index}`}
                          x={mappedCoords.x}
                          y={mappedCoords.y}
                          width={mappedCoords.width}
                          height={mappedCoords.height}
                          stroke="blue"
                          strokeWidth={2}
                          fill="rgba(0, 0, 255, 0.2)"
                          onPress={() => handleTextSelection(element.text)}
                        />
                      );
                    }
                    return null;
                  })}
                </>
              )}
            </Svg>
          </View>
        )}
        
        {/* Display highlighted text areas - Only show when drawing is disabled and there are results */}
        {!isDrawingEnabled && ocrResult && ocrComplete && imageSize.width > 0 && intersectingElements.length > 0 && (
          <View style={[styles.ocrOverlay, { pointerEvents: 'box-none' }]}>
            <Svg height="100%" width="100%" style={{ pointerEvents: 'box-none' }}>
              {intersectingElements.map((elem, index) => {
                const { blockIndex, lineIndex, elementIndex } = elem;
                const element = ocrResult.blocks[blockIndex]?.lines?.[lineIndex]?.elements?.[elementIndex];
                
                if (element && element.frame) {
                  const frame = element.frame as any;
                  let x = frame.left || frame.x || 0;
                  let y = frame.top || frame.y || 0;
                  let width = frame.width || (frame.right ? frame.right - x : 0);
                  let height = frame.height || (frame.bottom ? frame.bottom - y : 0);
                  
                  const mappedCoords = mapCoordinates(x, y, width, height);
                  
                  return (
                    <Rect
                      key={`selected-element-${index}`}
                      x={mappedCoords.x}
                      y={mappedCoords.y}
                      width={mappedCoords.width}
                      height={mappedCoords.height}
                      stroke="blue"
                      strokeWidth={2}
                      fill="rgba(0, 0, 255, 0.2)"
                      onPress={() => handleTextSelection(element.text)}
                      pointerEvents="box-only" // Only capture press events, let others pass through
                    />
                  );
                }
                return null;
              })}
            </Svg>
          </View>
        )}
      </View>

      <View style={styles.controls}>
        {ocrComplete && paths.some(path => path.page === currentPage) && (
          <TouchableOpacity
            style={[styles.button, styles.clearDrawingButton]}
            onPress={clearCurrentDrawing}
            disabled={isProcessing}
          >
            <Text style={styles.buttonText}>Clear Selection</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, styles.clearButton]}
          onPress={clearAll}
          disabled={isProcessing}
        >
          <Text style={styles.buttonText}>Clear All</Text>
        </TouchableOpacity>
      </View>

      {/* Processing indicator */}
      {isProcessing && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#4a90e2" />
          <Text style={styles.loadingText}>Analyzing text...</Text>
        </View>
      )}

      {/* Selected text container - now as floating overlay */}
      {selectedText && (
        <View style={styles.selectedTextOverlay}>
          <View style={styles.selectedTextContainer}>
            <View style={styles.selectedTextHeader}>
              <Text style={styles.selectedTextTitle}>Selected Text:</Text>
              <TouchableOpacity
                style={styles.closeTextButton}
                onPress={handleCloseTextPanel}
              >
                <Text style={styles.closeTextButtonText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.selectedTextScroll}>
              <Text style={styles.selectedText}>{selectedText}</Text>
            </ScrollView>
          </View>
        </View>
      )}

      {/* Debug Mode - Shows captured page image */}
      {pageImageUri && (
        <Modal
          visible={false} // Set to true to debug
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setPageImageUri(null);
          }}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Captured Page</Text>
              <View style={styles.imageContainer}>
                <Image
                  source={{ uri: pageImageUri }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => {
                  setPageImageUri(null);
                }}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  pageInfo: {
    fontSize: 14,
    color: '#666',
  },
  drawingToggleButton: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 4,
    borderWidth: 1,
  },
  activeButton: {
    backgroundColor: '#4caf50',
    borderColor: '#388e3c',
  },
  inactiveButton: {
    backgroundColor: '#f5f5f5',
    borderColor: '#ccc',
  },
  buttonTextSmall: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  pdfContainer: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    position: 'relative',
  },
  pdfView: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  pdf: {
    flex: 1,
    width: Dimensions.get('window').width,
    backgroundColor: '#f5f5f5',
  },
  ocrOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  controls: {
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
  },
  button: {
    backgroundColor: '#4a90e2',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 4,
  },
  clearButton: {
    backgroundColor: '#e74c3c',
  },
  clearDrawingButton: {
    backgroundColor: '#ff9800',
  },
  disabledButton: {
    backgroundColor: '#cccccc',
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#4a90e2',
  },
  selectedTextOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
    zIndex: 1000,
  },
  selectedTextContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
    padding: 16,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 5,
  },
  selectedTextHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  selectedTextTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  closeTextButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeTextButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#666',
    lineHeight: 20,
  },
  selectedTextScroll: {
    maxHeight: 150,
  },
  selectedText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  modalContent: {
    width: '90%',
    height: '80%',
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  imageContainer: {
    width: '100%',
    height: '90%',
    borderRadius: 10,
    overflow: 'hidden',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  closeButton: {
    marginTop: 15,
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#4a90e2',
    borderRadius: 5,
  },
  closeButtonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  activeButtonText: {
    color: 'white',
  },
  inactiveButtonText: {
    color: 'gray',
  },
  pageNavBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageNavBarButton: {
    backgroundColor: '#4a90e2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageNavBarButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  pageInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
  },
  pageInput: {
    backgroundColor: '#f5f5f5',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    width: 50,
    height: 32,
    borderRadius: 4,
    paddingHorizontal: 8,
    textAlign: 'center',
    fontSize: 14,
  },
  pageInputLabel: {
    marginLeft: 5,
    fontSize: 14,
    color: '#666',
  },
});

export default PdfViewerScreen; 