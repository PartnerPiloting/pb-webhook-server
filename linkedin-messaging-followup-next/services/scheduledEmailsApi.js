// The coach's Scheduled page - emails queued to send from his own mailbox
// (backend routes/scheduledEmailRoutes.js). Authenticated like every other portal call.
import axios from 'axios';
import { getBackendBase, getAuthenticatedHeaders } from './api';

const base = () => `${getBackendBase()}/api/scheduled-emails`;
const opts = (timeout = 30000) => ({ timeout, headers: getAuthenticatedHeaders() });

export const getScheduledEmails = async () => (await axios.get(base(), opts())).data;
export const getScheduledEmail = async (id) => (await axios.get(`${base()}/${id}`, opts())).data;

// Each action returns { success, message } - the message says exactly what changed.
const act = async (id, action, body = {}) => {
  try { return (await axios.post(`${base()}/${id}/${action}`, body, opts(60000))).data; }
  catch (e) { return (e.response && e.response.data) || { success: false, message: e.message }; }
};
export const approveScheduledEmail = (id) => act(id, 'approve');
export const editScheduledEmail = (id, { subject, html }) => act(id, 'edit', { subject, html });
export const moveScheduledEmail = (id, sendAt) => act(id, 'move', { sendAt });
export const cancelScheduledEmail = (id) => act(id, 'cancel');
export const sendScheduledEmailNow = (id) => act(id, 'send-now');

// "Network building, rethought" - this week's email to the list (backend services/listEditions.js).
const listAct = async (path, body = {}) => {
  try { return (await axios.post(`${base()}/list/${path}`, body, opts(60000))).data; }
  catch (e) { return (e.response && e.response.data) || { success: false, message: e.message }; }
};
export const approveListEdition = (id) => listAct(`${id}/approve`);
export const holdListEdition = (id) => listAct(`${id}/hold`);
export const editListEdition = (id, { title, body }) => listAct(`${id}/edit`, { title, body });
export const testListEdition = () => listAct('test');
