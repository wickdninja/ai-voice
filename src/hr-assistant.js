// hr-assistant.js
// This file handles the client-side logic for the HR Assistant functionality

// Import the OpenAI client
// In a production app, you'd use a server-side API to handle the OpenAI calls
// This is a simplified client-side implementation for the POC
import { createSocket } from './socket-service';

// Audio processing variables
let mediaRecorder;
let audioChunks = [];
let socket;
let isListening = false;
let userId;
let isProcessingAudio = false; // Flag to track audio processing state
let processingTimeout; // For debouncing audio processing

// Initialize speech synthesis
const synth = window.speechSynthesis;

/**
 * Start the HR Assistant functionality
 * @param {MediaStream} stream - The user's audio stream
 * @param {Function} callback - Callback for receiving assistant responses
 * @param {Function} transcriptionCallback - Callback for receiving user transcriptions
 */
export const startHRAssistant = (stream, callback, transcriptionCallback) => {
  // Connect to the signaling server
  socket = createSocket();
  userId = socket.id;
  
  // Setup audio recording from the user's stream
  setupAudioRecording(stream);
  
  // Listen for responses from the HR Assistant
  socket.on("assistantResponse", (data) => {
    console.log("Received assistant response:", data);
    
    if (data.text) {
      // Speak the response using speech synthesis
      speakResponse(data.text);
      
      // Call the callback with the response
      if (callback) callback(data.text);
    }
  });
  
  // Listen for user's transcription
  socket.on("userTranscription", (data) => {
    console.log("Received user transcription:", data);
    
    if (data.text && transcriptionCallback) {
      transcriptionCallback(data.text);
    }
  });
  
  isListening = true;
  console.log("HR Assistant started");
};

/**
 * Stop the HR Assistant functionality
 */
export const stopHRAssistant = () => {
  isListening = false;
  
  if (mediaRecorder) {
    // Clear the interval
    if (mediaRecorder.intervalId) {
      clearInterval(mediaRecorder.intervalId);
    }
    
    // Stop recording if active
    if (mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch (err) {
        console.error('Error stopping mediaRecorder:', err);
      }
    }
    
    mediaRecorder = null;
  }
  
  // Clear audio chunks
  audioChunks = [];
  
  if (socket) {
    socket.emit("endCall", { userId });
    socket.disconnect();
    socket = null;
  }
  
  console.log("HR Assistant stopped");
};

/**
 * Setup audio recording from the user's stream
 * @param {MediaStream} stream - The user's audio stream
 */
const setupAudioRecording = (stream) => {
  console.log('[DEBUG] Setting up audio recording with stream:', stream);
  console.log('[DEBUG] Stream tracks:', stream.getTracks().map(t => ({
    kind: t.kind, 
    enabled: t.enabled,
    readyState: t.readyState,
    id: t.id
  })));
  
  // Check available MIME types
  const mimeTypes = [
    'audio/webm',
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav'
  ];
  
  let selectedType = 'audio/webm';
  console.log('[DEBUG] Checking supported MIME types:');
  mimeTypes.forEach(type => {
    console.log(`[DEBUG] ${type}: ${MediaRecorder.isTypeSupported(type) ? 'Supported' : 'Not supported'}`);
    if (MediaRecorder.isTypeSupported(type)) {
      selectedType = type;
    }
  });
  
  console.log('[DEBUG] Selected MIME type:', selectedType);
  
  // Create a MediaRecorder to capture audio chunks with specific mime type
  try {
    mediaRecorder = new MediaRecorder(stream, { 
      mimeType: selectedType,
      audioBitsPerSecond: 128000 
    });
    console.log('[DEBUG] MediaRecorder created with options:', { 
      mimeType: selectedType,
      audioBitsPerSecond: 128000 
    });
  } catch (err) {
    console.error('[DEBUG] Error creating MediaRecorder:', err);
    // Fallback to default options
    mediaRecorder = new MediaRecorder(stream);
    console.log('[DEBUG] MediaRecorder created with default options');
  }
  
  console.log('[DEBUG] MediaRecorder state:', mediaRecorder.state);
  console.log('[DEBUG] MediaRecorder mimeType:', mediaRecorder.mimeType);
  
  // Set up event handlers
  mediaRecorder.ondataavailable = (event) => {
    console.log('[DEBUG] MediaRecorder ondataavailable event:', {
      size: event.data ? event.data.size : 'no data',
      type: event.data ? event.data.type : 'no type'
    });
    
    if (event.data && event.data.size > 0) {
      console.log('[DEBUG] Adding audio chunk, size:', event.data.size);
      audioChunks.push(event.data);
    } else {
      console.warn('[DEBUG] Received empty audio data');
    }
  };
  
  mediaRecorder.onerror = (event) => {
    console.error('[DEBUG] MediaRecorder error:', event);
  };
  
  mediaRecorder.onstop = async () => {
    console.log('[DEBUG] MediaRecorder stopped');
    // When recording stops, process the audio if we have chunks
    if (audioChunks.length > 0) {
      console.log('[DEBUG] Processing audio chunks, count:', audioChunks.length);
      await processAudioChunks();
      // Chunks are cleared in processAudioChunks
    } else {
      console.warn('[DEBUG] No audio chunks to process after stop');
    }
  };
  
  // Start recording in small chunks (500ms)
  try {
    mediaRecorder.start(500);
    console.log('[DEBUG] MediaRecorder started successfully, state:', mediaRecorder.state);
  } catch (err) {
    console.error('[DEBUG] Error starting MediaRecorder:', err);
  }
  
  // Setup a timer to stop and restart recording periodically
  // This creates chunks of audio that can be sent to the server
  const intervalId = setInterval(() => {
    if (isListening && mediaRecorder) {
      console.log('[DEBUG] Interval check - mediaRecorder state:', mediaRecorder.state);
      
      if (mediaRecorder.state === 'recording') {
        console.log('[DEBUG] Stopping recorder to process audio chunks');
        try {
          mediaRecorder.stop();
        } catch (err) {
          console.error('[DEBUG] Error stopping MediaRecorder:', err);
        }
        
        // Start recording again after processing
        setTimeout(() => {
          if (isListening && mediaRecorder) {
            console.log('[DEBUG] Starting recorder again');
            try {
              mediaRecorder.start(500);
              console.log('[DEBUG] Recorder restarted, state:', mediaRecorder.state);
            } catch (err) {
              console.error('[DEBUG] Error restarting MediaRecorder:', err);
            }
          }
        }, 300);
      } else {
        console.warn('[DEBUG] MediaRecorder not in recording state during interval check:', mediaRecorder.state);
        // Try to restart if not recording
        if (mediaRecorder.state === 'inactive' && isListening) {
          try {
            console.log('[DEBUG] Attempting to restart inactive recorder');
            mediaRecorder.start(500);
          } catch (err) {
            console.error('[DEBUG] Error restarting inactive MediaRecorder:', err);
          }
        }
      }
    }
  }, 3000);
  
  console.log('[DEBUG] Set up recorder interval, ID:', intervalId);
  
  // Store the interval ID so we can clear it later
  mediaRecorder.intervalId = intervalId;
};

/**
 * Process the recorded audio chunks
 * @param {boolean} force - Whether to force processing even if chunks are small
 */
const processAudioChunks = async (force = false) => {
  console.log('processAudioChunks called with force =', force);
  console.log('isProcessingAudio =', isProcessingAudio);
  console.log('audioChunks.length =', audioChunks.length);
  console.log('isListening =', isListening);
  
  if (isProcessingAudio) {
    console.log('[DEBUG] Already processing audio, skipping');
    return;
  }
  
  if (audioChunks.length === 0 || !isListening) {
    console.log('[DEBUG] No audio chunks to process or not listening');
    return;
  }
  
  try {
    console.log(`[DEBUG] Processing ${audioChunks.length} audio chunks`);
    isProcessingAudio = true;
    
    // Create a blob from the audio chunks
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    console.log('[DEBUG] Audio blob created, size:', audioBlob.size, 'type:', audioBlob.type);
    
    // Skip if the blob is too small (likely just silence) unless forced
    if (audioBlob.size < 1000 && !force) {
      console.log('[DEBUG] Audio blob too small, likely silence. Skipping.');
      isProcessingAudio = false;
      return;
    }
    
    // Log the first few chunks as base64 for debugging
    if (audioChunks.length > 0) {
      const reader = new FileReader();
      reader.onload = function() {
        const base64data = reader.result;
        console.log('[DEBUG] First chunk preview (base64):', base64data.substr(0, 100) + '...');
      };
      reader.readAsDataURL(audioChunks[0]);
    }
    
    // Convert blob to ArrayBuffer for sending to server
    const arrayBuffer = await audioBlob.arrayBuffer();
    console.log('[DEBUG] Converted to ArrayBuffer, size:', arrayBuffer.byteLength);
    
    // Send the ArrayBuffer to our server for OpenAI processing
    if (socket && socket.connected) {
      console.log('[DEBUG] Socket state:', socket.connected ? 'connected' : 'disconnected', 'ID:', socket.id);
      console.log('[DEBUG] Sending audio chunk to server');
      
      // Add event listeners for this specific emit
      const onceAck = (data) => {
        console.log('[DEBUG] Server acknowledged receipt of audio chunk:', data);
      };
      
      socket.once('audioChunkReceived', onceAck);
      
      // Emit with a callback to confirm receipt
      socket.emit("audioChunk", { 
        chunk: arrayBuffer,
        userId
      }, (response) => {
        console.log('[DEBUG] Server callback response:', response);
      });
      
      // Clear audio chunks after sending
      console.log('[DEBUG] Clearing audio chunks array');
      audioChunks = [];
    } else {
      console.error('[DEBUG] Socket not connected, cannot send audio chunk');
      console.log('[DEBUG] Socket details:', socket ? `ID: ${socket.id}` : 'Socket is null');
    }
    
    // Reset processing flag after a short delay
    console.log('[DEBUG] Setting timeout to reset processing flag');
    setTimeout(() => {
      console.log('[DEBUG] Resetting isProcessingAudio flag to false');
      isProcessingAudio = false;
    }, 1000);
  } catch (error) {
    console.error("[DEBUG] Error processing audio:", error);
    console.error("[DEBUG] Error stack:", error.stack);
    isProcessingAudio = false;
  }
};

/**
 * Start manual push-to-talk recording
 */
export const startPushToTalk = () => {
  console.log('[DEBUG] startPushToTalk called');
  console.log('[DEBUG] isListening:', isListening);
  console.log('[DEBUG] mediaRecorder:', mediaRecorder ? mediaRecorder.state : 'not initialized');
  
  if (!isListening || !mediaRecorder) {
    console.log('[DEBUG] Cannot start push-to-talk: HR Assistant not active');
    return false;
  }
  
  // Clear any existing audio chunks
  console.log('[DEBUG] Clearing existing audio chunks, count:', audioChunks.length);
  audioChunks = [];
  
  // Start a new recording if not already recording
  if (mediaRecorder.state !== 'recording') {
    console.log('[DEBUG] Starting recording for push-to-talk');
    try {
      mediaRecorder.start(100);
      console.log('[DEBUG] MediaRecorder started, state:', mediaRecorder.state);
    } catch (err) {
      console.error('[DEBUG] Error starting MediaRecorder for push-to-talk:', err);
    }
  } else {
    console.log('[DEBUG] MediaRecorder already in recording state');
  }
  
  // Clear any pending processing
  if (processingTimeout) {
    console.log('[DEBUG] Clearing pending processing timeout');
    clearTimeout(processingTimeout);
  }
  
  return true;
};

/**
 * End manual push-to-talk and process the audio
 */
export const endPushToTalk = () => {
  console.log('[DEBUG] endPushToTalk called');
  console.log('[DEBUG] isListening:', isListening);
  console.log('[DEBUG] mediaRecorder:', mediaRecorder ? mediaRecorder.state : 'not initialized');
  console.log('[DEBUG] Current audio chunks:', audioChunks.length);
  
  if (!isListening || !mediaRecorder) {
    console.log('[DEBUG] Cannot end push-to-talk: HR Assistant not active');
    return false;
  }
  
  console.log('[DEBUG] Ending push-to-talk recording');
  
  // Stop recording if active
  if (mediaRecorder.state === 'recording') {
    console.log('[DEBUG] Stopping MediaRecorder');
    try {
      mediaRecorder.stop();
      console.log('[DEBUG] MediaRecorder stopped successfully');
    } catch (err) {
      console.error('[DEBUG] Error stopping MediaRecorder:', err);
    }
  } else {
    console.warn('[DEBUG] MediaRecorder not in recording state:', mediaRecorder.state);
  }
  
  // Process immediately with force flag
  console.log('[DEBUG] Setting up forced audio processing timeout');
  processingTimeout = setTimeout(() => {
    console.log('[DEBUG] Executing forced processing of audio chunks');
    processAudioChunks(true);
  }, 300);
  
  return true;
};

/**
 * Speak the response using the Web Speech API
 * @param {string} text - The text to speak
 */
const speakResponse = (text) => {
  // Create a new utterance
  const utterance = new SpeechSynthesisUtterance(text);
  
  // Configure voice settings
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;
  
  // Try to use a female voice for the HR assistant
  const voices = synth.getVoices();
  const femaleVoice = voices.find(voice => 
    voice.name.includes('Female') || 
    voice.name.includes('Samantha') ||
    voice.name.includes('Victoria')
  );
  
  if (femaleVoice) {
    utterance.voice = femaleVoice;
  }
  
  // Speak the response
  synth.speak(utterance);
};

// Export any other necessary functions or constants
export const isHRAssistantActive = () => isListening;