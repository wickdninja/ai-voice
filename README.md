# AI HR Voice Assistant POC

A proof-of-concept for an AI-powered HR assistant that enables real-time voice conversations using OpenAI's real-time APIs and WebRTC technology.

## Features

- Real-time voice conversation with an AI HR assistant
- Web-based interface built with React
- WebRTC for audio streaming
- Integration with OpenAI's real-time API for natural language processing
- Simulated HR responses to common HR-related questions

## Technology Stack

- Frontend: React
- Backend: Node.js with Express
- WebRTC: Simple-peer for peer-to-peer connections
- Signaling: Socket.io for WebRTC signaling
- AI: OpenAI's API for real-time speech processing

## Getting Started

### Prerequisites

- Node.js (v14 or higher)
- NPM (v6 or higher)
- OpenAI API key

### Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

Create a `.env` file in the root directory and add your OpenAI API key:

```
OPENAI_API_KEY=your-api-key-here
```

### Running the Application

Start the development server:

```bash
npm run dev
```

This will start both the React frontend and the Express backend concurrently.

- Frontend: http://localhost:3000
- Backend: http://localhost:8000

## Usage

1. Open the application in your browser
2. Click "Call HR Assistant" to initiate a conversation
3. Allow microphone access when prompted
4. Speak naturally to ask HR-related questions
5. For demo purposes, you can also click "Simulate Question" to test the assistant's responses
6. Click "End Call" to terminate the conversation

## Implementation Details

### Voice Processing Flow

1. User's voice is captured through the browser's media API
2. Audio is sent to the server via WebRTC and Socket.io
3. Server processes the audio with OpenAI's real-time API
4. AI-generated responses are streamed back to the client
5. Responses are played through the browser's speech synthesis API

### HR Assistant Capabilities

The demo includes simulated responses to common HR questions about:

- Vacation policies
- Health benefits
- Performance reviews
- Work-from-home policies
- Retirement benefits

## Extending the POC

To create a production-ready version, consider:

1. Implementing proper authentication and user management
2. Storing conversation history in a database
3. Adding analytics for tracking usage and performance
4. Enhancing the AI with company-specific HR knowledge
5. Implementing better error handling and fallback mechanisms

## License

MIT