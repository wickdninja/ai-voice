const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { OpenAI } = require("openai");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Initialize OpenAI
// NOTE: In production, use environment variables for API keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "TODO: REPLACE_ME";

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Check if OpenAI API key is valid
(async function validateOpenAIKey() {
  try {
    // Simple model validation call
    await openai.models.list();
    console.log("OpenAI API connection successful");
  } catch (error) {
    console.error("Error connecting to OpenAI API:", error.message);
    console.error("Please check your API key and network connection");
  }
})();

// Store active calls
const activeCalls = {};

// Socket.io connection
io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  // When a user tries to call
  socket.on("callUser", ({ userToCall, signalData, from }) => {
    console.log(`Call request from ${from} to ${userToCall}`);

    // If this is a call to the HR Assistant
    if (userToCall === "hr-assistant") {
      // Create a unique room for this call
      const roomId = `call-${from}`;
      socket.join(roomId);

      // Store the call information
      activeCalls[from] = {
        roomId,
        startTime: Date.now(),
        audioChunks: [],
      };

      // Simulate the HR Assistant accepting the call
      setTimeout(() => {
        socket.emit("callAccepted", {
          signal: signalData, // Loop back signal for demo
          from: "hr-assistant",
        });

        console.log(`HR Assistant accepted call from ${from}`);
      }, 1000);
    } else {
      // Regular user-to-user call - forward to the recipient
      io.to(userToCall).emit("callUser", {
        signal: signalData,
        from,
      });
    }
  });

  // Handle answer call
  socket.on("answerCall", (data) => {
    io.to(data.to).emit("callAccepted", {
      signal: data.signal,
      from: socket.id,
    });
  });

  // Receive audio chunk for processing
  socket.on("audioChunk", async ({ chunk, userId }, callback) => {
    console.log(
      `[SERVER] Received audio chunk from user ${userId}, size:`,
      chunk.byteLength
    );

    // Send acknowledgement if callback exists
    if (typeof callback === "function") {
      callback({ received: true, size: chunk.byteLength });
    }

    // Also emit an event for explicit acknowledgement
    socket.emit("audioChunkReceived", {
      received: true,
      size: chunk.byteLength,
    });

    // Initialize user in activeCalls if not exists
    if (!activeCalls[userId]) {
      console.log(`[SERVER] Creating new call for user ${userId}`);
      activeCalls[userId] = {
        roomId: `call-${userId}`,
        startTime: Date.now(),
        audioChunks: [],
      };
    }

    // Store audio chunk
    activeCalls[userId].audioChunks.push(chunk);
    console.log(
      `[SERVER] User ${userId} now has ${activeCalls[userId].audioChunks.length} audio chunks`
    );

    // Process immediately
    try {
      console.log(`[SERVER] Starting to process audio for user ${userId}`);

      // Combine audio chunks into a single blob/file
      const chunks = activeCalls[userId].audioChunks.map((chunk) => {
        try {
          return Buffer.from(new Uint8Array(chunk));
        } catch (err) {
          console.error("[SERVER] Error converting chunk to Buffer:", err);
          return Buffer.alloc(0); // Return empty buffer on error
        }
      });

      console.log(`[SERVER] Processed ${chunks.length} chunks for conversion`);

      const audioBuffer = Buffer.concat(chunks);
      console.log(`[SERVER] Created audio buffer of size:`, audioBuffer.length);

      // Try both methods: file-based and direct buffer
      try {
        console.log(`[SERVER] Attempting to transcribe audio`);

        // Option 1: Use a temporary file
        const fs = require("fs");
        const tempFilePath = path.join(__dirname, `temp-${userId}.webm`);

        console.log(`[SERVER] Saving audio to temporary file: ${tempFilePath}`);
        fs.writeFileSync(tempFilePath, audioBuffer);

        console.log(
          `[SERVER] File saved, size:`,
          fs.statSync(tempFilePath).size
        );
        console.log(`[SERVER] File exists:`, fs.existsSync(tempFilePath));

        // Check if the file is valid
        const stats = fs.statSync(tempFilePath);
        console.log(`[SERVER] File stats:`, {
          size: stats.size,
          isFile: stats.isFile(),
          created: stats.birthtime,
        });

        // Transcribe the audio using OpenAI
        console.log(`[SERVER] Calling OpenAI Whisper API with file`);

        // Create a File object from the buffer for OpenAI
        console.log("[SERVER] Creating File object for OpenAI");

        // Creating a form data object with the file
        const FormData = require("form-data");
        const form = new FormData();
        form.append("file", fs.createReadStream(tempFilePath), {
          filename: `audio-${userId}.webm`,
          contentType: "audio/webm",
        });
        form.append("model", "whisper-1");

        console.log("[SERVER] Directly calling OpenAI API with form data");

        // Use raw fetch API for debugging
        const fetch = require("node-fetch");
        const response = await fetch(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              ...form.getHeaders(),
            },
            body: form,
          }
        );

        const result = await response.json();
        console.log("[SERVER] Raw API response:", result);

        // Assuming result has a text property
        const transcriptionText = result.text || "";
        console.log(
          `[SERVER] Transcription text from raw API: "${transcriptionText}"`
        );

        // Clean up the temporary file
        console.log(`[SERVER] Deleting temporary file`);
        fs.unlinkSync(tempFilePath);

        // Create a transcription object to match the expected format
        const transcription = { text: transcriptionText };

        // If we got a transcription, process it with ChatGPT
        if (transcription.text && transcription.text.trim() !== "") {
          console.log(
            `[SERVER] Valid transcription received, sending to client`
          );

          // Send transcription back to client
          socket.emit("userTranscription", {
            text: transcription.text,
          });

          // Update conversation history with user message
          updateConversationHistory(userId, "user", transcription.text);
          console.log(
            `[SERVER] Updated conversation history with user message`
          );

          // Create a chat completion with full conversation history
          console.log(
            `[SERVER] Calling GPT API with conversation history:`,
            JSON.stringify(hrConversationHistory[userId])
          );

          const chatCompletion = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: hrConversationHistory[userId],
            temperature: 0.7,
            max_tokens: 150,
          });

          console.log(`[SERVER] Received chat completion:`, chatCompletion);

          const response = chatCompletion.choices[0].message.content;

          // Update conversation history with assistant's response
          updateConversationHistory(userId, "assistant", response);

          // Log the conversation
          console.log(`[SERVER] User ${userId}: "${transcription.text}"`);
          console.log(`[SERVER] HR Assistant: "${response}"`);

          // Send processed response back to the user
          console.log(`[SERVER] Sending assistant response to client`);
          socket.emit("assistantResponse", {
            text: response,
            audio: null, // In a real implementation, you could also convert response to audio
          });
        } else {
          console.log(
            `[SERVER] Empty transcription received, sending feedback message`
          );
          // If no transcription, use a feedback message
          socket.emit("assistantResponse", {
            text: "I'm sorry, I couldn't understand what you said. Could you please repeat that?",
            audio: null,
          });
        }
      } catch (err) {
        console.error("[SERVER] Error processing audio file:", err);
        console.error("[SERVER] Error stack:", err.stack);

        // Try to clean up the file if it exists
        if (fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (unlinkErr) {
            console.error("[SERVER] Error deleting temporary file:", unlinkErr);
          }
        }

        // Send an error message to the client
        socket.emit("assistantResponse", {
          text: "I'm sorry, there was an error processing your audio. Please try again.",
          audio: null,
        });
      }

      // Clear the chunks
      activeCalls[userId].audioChunks = [];
    } catch (error) {
      console.error("Error processing audio with OpenAI:", error);
      socket.emit("assistantResponse", {
        text: "I'm sorry, there was an error processing your request. Please try again.",
        audio: null,
      });

      // Clear the chunks even on error
      activeCalls[userId].audioChunks = [];
    }
  });

  // Handle call end
  socket.on("endCall", ({ userId }) => {
    if (activeCalls[userId]) {
      // Clean up the call
      delete activeCalls[userId];

      // Clean up conversation history
      if (hrConversationHistory[userId]) {
        delete hrConversationHistory[userId];
      }

      console.log(`Call ended for user ${userId}`);
    }
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log(`User Disconnected: ${socket.id}`);
    // Clean up any active calls
    Object.keys(activeCalls).forEach((userId) => {
      if (activeCalls[userId].roomId.includes(socket.id)) {
        delete activeCalls[userId];
      }
    });
  });
});

// HR conversation history - to maintain context in future implementations
const hrConversationHistory = {};

// Function to store conversation history for each user
function updateConversationHistory(userId, role, content) {
  if (!hrConversationHistory[userId]) {
    hrConversationHistory[userId] = [
      {
        role: "system",
        content:
          "You are an HR assistant for AI, a company that provides HR services. Answer questions about HR policies, benefits, and other work-related topics concisely and professionally.",
      },
    ];
  }

  // Add the new message
  hrConversationHistory[userId].push({
    role,
    content,
  });

  // Keep only the last 10 messages to prevent context size from growing too large
  if (hrConversationHistory[userId].length > 10) {
    // Always keep the system message
    const systemMessage = hrConversationHistory[userId][0];
    hrConversationHistory[userId] = [
      systemMessage,
      ...hrConversationHistory[userId].slice(-9),
    ];
  }
}

// Serve static files in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "build")));
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "build", "index.html"));
  });
}

const PORT = process.env.PORT || 8000;

// Try to start server on the specified port, but use next available if port is taken
const startServer = (port) => {
  server
    .listen(port)
    .on("listening", () => {
      console.log(`Server running on port ${port}`);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`Port ${port} is already in use, trying port ${port + 1}`);
        startServer(port + 1);
      } else {
        console.error("Server error:", err);
      }
    });
};

startServer(PORT);
