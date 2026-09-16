// The coach's client board - "My Clients". Two reads against the backend, both authenticated
// the same way as every other portal call (portal token or dev key in the headers).
import axios from 'axios';
import { getBackendBase, getAuthenticatedHeaders } from './api';

export const getClientBoard = async () => {
  const response = await axios.get(`${getBackendBase()}/api/client-board`, {
    timeout: 45000,
    headers: getAuthenticatedHeaders(),
  });
  return response.data;
};

export const getClientBoardDetail = async (clientId) => {
  const response = await axios.get(`${getBackendBase()}/api/client-board/${encodeURIComponent(clientId)}/detail`, {
    timeout: 90000,
    headers: getAuthenticatedHeaders(),
  });
  return response.data;
};

// Mint the "connect your calendar and mailbox" link for one client (the concierge sheet, beat 3).
// Unipile calls the server back when the client approves it and the record sets itself.
export const mintUnipileLink = async (clientId) => {
  const response = await axios.post(`${getBackendBase()}/api/client-board/${encodeURIComponent(clientId)}/unipile-link`, {}, {
    timeout: 30000,
    headers: getAuthenticatedHeaders(),
  });
  return response.data;
};
