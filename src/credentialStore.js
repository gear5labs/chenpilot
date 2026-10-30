const credentials = new Map();
const auditLog = [{ timestamp: new Date().toISOString(), action: "SYSTEM_INITIALIZED", details: { service: "Chen Pilot Server" } }];
function removeCredential(id) { credentials.delete(id); return true; }
function listAuditLog() { return [...auditLog]; }
function saveCredential(id, cred) { const c = credentials.get(id) || []; c.push(cred); credentials.set(id, c); return cred; }
function getCredentials(id) { return credentials.get(id) || []; }
module.exports = { removeCredential, listAuditLog, saveCredential, getCredentials };
