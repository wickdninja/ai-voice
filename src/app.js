import React, { useEffect, useState, useRef } from "react";
import {
  startHRAssistant,
  stopHRAssistant,
  isHRAssistantActive,
  startPushToTalk,
  endPushToTalk,
} from "./hr-assistant";
import "./App.css";

function App() {
  const [stream, setStream] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [isPushToTalk, setIsPushToTalk] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [eqBars, setEqBars] = useState(Array(20).fill(0));
  const [assistantEqBars, setAssistantEqBars] = useState(Array(20).fill(0));

  // Refs
  const audioRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationRef = useRef(null);

  // Create cool EQ animation for user
  const generateRandomEQ = (isActive, maxHeight = 50) => {
    return Array(20)
      .fill(0)
      .map(() => {
        if (!isActive) return Math.random() * 5; // Low values when not active
        return Math.random() * maxHeight;
      });
  };

  // Generate assistant EQ animation
  useEffect(() => {
    if (!isPlayingAudio) return;

    const interval = setInterval(() => {
      setAssistantEqBars(generateRandomEQ(true, 70));
    }, 100);

    return () => clearInterval(interval);
  }, [isPlayingAudio]);

  // Set up audio visualization when stream is available
  useEffect(() => {
    if (!stream) return;

    // Set up audio context and analyzer
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext ||
        window.webkitAudioContext)();
    }

    const audioContext = audioContextRef.current;
    const analyser = audioContext.createAnalyser();
    analyserRef.current = analyser;

    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    // Connect the stream to the analyzer
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    // Visualization loop
    const updateAudioLevel = () => {
      if (!analyserRef.current) return;

      analyserRef.current.getByteFrequencyData(dataArray);

      // Calculate average level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      const normalizedLevel = Math.min(100, Math.max(0, avg * 2)); // Scale 0-100

      // Update audio level
      setAudioLevel(normalizedLevel);

      // Update EQ visualization with frequency data
      // Use a subset of the frequency data to create the EQ bars
      const newEqBars = [];
      const step = Math.floor(bufferLength / 20);
      for (let i = 0; i < 20; i++) {
        const index = i * step;
        newEqBars.push(dataArray[index] / 2); // Scale down to reasonable height
      }
      setEqBars(newEqBars);

      // Detect if user is speaking
      setIsCapturing(normalizedLevel > 5);

      animationRef.current = requestAnimationFrame(updateAudioLevel);
    };

    animationRef.current = requestAnimationFrame(updateAudioLevel);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      source.disconnect();
    };
  }, [stream]);

  // Processing state handling
  useEffect(() => {
    // Reset processing state when assistant starts speaking
    if (isPlayingAudio) {
      setIsProcessing(false);
    }
  }, [isPlayingAudio]);

  // Handle speech synthesis events
  useEffect(() => {
    const synth = window.speechSynthesis;

    const handleSpeakStart = () => setIsPlayingAudio(true);
    const handleSpeakEnd = () => setIsPlayingAudio(false);

    synth.addEventListener("voiceschanged", () => {
      // Force reload available voices
      synth.getVoices();
    });

    window.addEventListener("speechstart", handleSpeakStart);
    window.addEventListener("speechend", handleSpeakEnd);

    // Chrome and Firefox have different events
    window.addEventListener("start", handleSpeakStart);
    window.addEventListener("end", handleSpeakEnd);

    return () => {
      window.removeEventListener("speechstart", handleSpeakStart);
      window.removeEventListener("speechend", handleSpeakEnd);
      window.removeEventListener("start", handleSpeakStart);
      window.removeEventListener("end", handleSpeakEnd);
    };
  }, []);

  // Component cleanup
  useEffect(() => {
    // Clean up when component unmounts
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (isHRAssistantActive()) {
        stopHRAssistant();
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, [stream]);

  const startCall = async () => {
    setIsConnecting(true);
    setError("");

    try {
      console.log("Requesting microphone permission...");

      // Check if mediaDevices is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser does not support mediaDevices API");
      }

      // Request microphone access with explicit constraints
      const userStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      console.log("Microphone permission granted!", userStream);

      // Check if we got audio tracks
      if (userStream.getAudioTracks().length === 0) {
        throw new Error("No audio tracks available in the media stream");
      }

      console.log("Audio tracks:", userStream.getAudioTracks());

      setStream(userStream);

      // Start the HR Assistant
      startHRAssistant(
        userStream,
        // Assistant response callback
        (response) => {
          // Add the assistant's response to the transcript
          setTranscript((prev) => [
            ...prev,
            {
              speaker: "Assistant",
              text: response,
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        },
        // User transcription callback
        (transcription) => {
          // Add the user's transcription to the transcript
          setTranscript((prev) => [
            ...prev,
            {
              speaker: "You",
              text: transcription,
              timestamp: new Date().toLocaleTimeString(),
            },
          ]);
        }
      );

      setIsConnected(true);
      setIsConnecting(false);

      // Add initial message to transcript
      setTranscript([
        {
          speaker: "Assistant",
          text: "Hello! I'm your HR Assistant. How can I help you today?",
          timestamp: new Date().toLocaleTimeString(),
        },
      ]);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError(
        "Could not access your microphone. Please make sure it's connected and permissions are granted."
      );
      setIsConnecting(false);
    }
  };

  const endCall = () => {
    // Stop the HR Assistant
    if (isHRAssistantActive()) {
      stopHRAssistant();
    }

    // Stop and release the media stream
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    setIsConnected(false);
    setStream(null);

    // Add call ended message
    setTranscript((prev) => [
      ...prev,
      {
        speaker: "System",
        text: "Call ended.",
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  };

  // Manual push-to-talk functionality
  const handleStartPushToTalk = () => {
    setIsPushToTalk(true);
    setIsProcessing(false); // Reset processing state
    if (isHRAssistantActive()) {
      console.log("Starting manual voice capture");
      startPushToTalk();
    }
  };

  const handleEndPushToTalk = () => {
    setIsPushToTalk(false);
    setIsProcessing(true); // Show processing state
    if (isHRAssistantActive()) {
      console.log("Ending manual voice capture, processing audio");
      endPushToTalk();
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>AI HR Voice Assistant</h1>
        <p>Real-time voice conversation with AI HR Assistant</p>
      </header>

      <main className="app-main">
        <div className="call-status">
          {!isConnected && !isConnecting && (
            <div className="status-offline">
              <span className="status-dot offline"></span>
              Not connected
            </div>
          )}

          {isConnecting && (
            <div className="status-connecting">
              <span className="status-dot connecting"></span>
              Connecting...
            </div>
          )}

          {isConnected && (
            <div className="status-online">
              <span className="status-dot online"></span>
              Connected to HR Assistant
            </div>
          )}
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="conversation-container">
          {transcript.map((entry, index) => (
            <div
              key={index}
              className={`message ${entry.speaker.toLowerCase()}`}
            >
              <div className="message-header">
                <span className="speaker">{entry.speaker}</span>
                <span className="timestamp">{entry.timestamp}</span>
              </div>
              <div className="message-body">{entry.text}</div>
            </div>
          ))}
        </div>

        <div className="controls">
          {!isConnected ? (
            <div className="start-call-container">
              <h2 className="call-prompt">
                Ready to chat with your HR Assistant?
              </h2>
              <p className="call-description">
                Get answers to your HR questions through a voice conversation.
              </p>
              <button
                className="call-button start"
                onClick={startCall}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <>
                    <div className="loading-spinner"></div>
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <span className="call-icon">📞</span>
                    <span>Start Voice Call</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="active-call-controls">
              <button className="call-button end" onClick={endCall}>
                End Call
              </button>
              <div className="audio-controls">
                {/* Processing indicator */}
                {isProcessing && !isPlayingAudio && (
                  <div className="processing-eq">
                    <div className="processing-spinner"></div>
                    <div className="processing-text">
                      Processing your request...
                    </div>
                  </div>
                )}

                {/* Assistant's EQ visualization */}
                {isPlayingAudio && (
                  <div className="eq-container assistant-eq">
                    {assistantEqBars.map((height, index) => (
                      <div
                        key={`assistant-eq-${index}`}
                        className="eq-bar"
                        style={{ height: `${Math.max(5, height)}px` }}
                      />
                    ))}
                  </div>
                )}

                <button
                  className={`push-to-talk-btn ${isPushToTalk ? "active" : ""}`}
                  onMouseDown={handleStartPushToTalk}
                  onMouseUp={handleEndPushToTalk}
                  onTouchStart={handleStartPushToTalk}
                  onTouchEnd={handleEndPushToTalk}
                  disabled={isPlayingAudio || isProcessing}
                >
                  {isPushToTalk ? "Release to Send" : "Push to Talk"}
                </button>

                <div className="speech-status">
                  {isPushToTalk && (
                    <div className="status-text capturing">
                      Recording your question...
                    </div>
                  )}
                  {isCapturing && !isPushToTalk && (
                    <div className="status-text capturing">
                      Voice detected - speaking...
                    </div>
                  )}
                  {isPlayingAudio && (
                    <div className="status-text speaking">
                      Assistant is speaking...
                    </div>
                  )}
                  {!isCapturing &&
                    !isPlayingAudio &&
                    !isPushToTalk &&
                    !isProcessing && (
                      <div className="status-text idle">
                        Press the button or start speaking
                      </div>
                    )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <p>AI HR Voice Assistant POC - Using OpenAI's Real-time API</p>

        {/* Debug status panel */}
        <div className="debug-panel">
          <details>
            <summary>Debug Status</summary>
            <div className="debug-status">
              <p>
                Connection:{" "}
                <span className={isConnected ? "green" : "red"}>
                  {isConnected ? "Connected" : "Disconnected"}
                </span>
              </p>
              <p>
                Stream:{" "}
                <span className={stream ? "green" : "red"}>
                  {stream ? "Active" : "Inactive"}
                </span>
              </p>
              <p>
                Capturing:{" "}
                <span className={isCapturing ? "green" : "red"}>
                  {isCapturing ? "Yes" : "No"}
                </span>
              </p>
              <p>
                Processing:{" "}
                <span className={isProcessing ? "yellow" : "gray"}>
                  {isProcessing ? "In Progress" : "Idle"}
                </span>
              </p>
              <p>
                Speaking:{" "}
                <span className={isPlayingAudio ? "purple" : "gray"}>
                  {isPlayingAudio ? "Yes" : "No"}
                </span>
              </p>
              <p>AudioLevel: {audioLevel.toFixed(1)}</p>
              <p>
                Push-to-Talk:{" "}
                <span className={isPushToTalk ? "red" : "gray"}>
                  {isPushToTalk ? "Active" : "Inactive"}
                </span>
              </p>
              <p>Transcript Length: {transcript.length}</p>
            </div>
          </details>
        </div>
      </footer>

      {/* User's voice animation fixed at the bottom */}
      {isConnected && (
        <div className="fixed-user-voice">
          <div className="eq-container user-eq">
            {eqBars.map((height, index) => (
              <div
                key={`user-eq-bottom-${index}`}
                className="eq-bar"
                style={{
                  height:
                    isCapturing || isPushToTalk
                      ? `${Math.max(5, height * 1.5)}px`
                      : "5px",
                  opacity: isCapturing || isPushToTalk ? 1 : 0.5,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
