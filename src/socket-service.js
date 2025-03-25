// socket-service.js
// A simple service to manage socket.io connections

import io from 'socket.io-client';

let socket = null;

/**
 * Create a socket connection to the server
 * @returns {Socket} The socket.io connection
 */
export const createSocket = () => {
  if (!socket) {
    // Connect to the local server
    // In production, this would be your actual server URL
    socket = io('http://localhost:8000');
    
    // Add default event handlers
    socket.on('connect', () => {
      console.log('Connected to server with ID:', socket.id);
    });
    
    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      socket = null;
    });
    
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  }
  
  return socket;
};

/**
 * Get the existing socket or create a new one
 * @returns {Socket} The socket.io connection
 */
export const getSocket = () => {
  if (!socket) {
    return createSocket();
  }
  return socket;
};

/**
 * Close the socket connection
 */
export const closeSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};