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
