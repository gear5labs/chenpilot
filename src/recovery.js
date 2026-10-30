const recoveryRequests = new Map();
function initiateRecovery({ threshold = 2, admins = [] }) {
  const requestId = "rec_" + Date.now();
  const req = { requestId, threshold, admins, approvals: [], status: "pending" };
  recoveryRequests.set(requestId, req);
  return req;
}
async function approve(requestId, userId) {
  const req = recoveryRequests.get(requestId);
  if (!req) throw new Error("Request not found");
  if (!req.approvals.includes(userId)) req.approvals.push(userId);
  return { ok: true, requestId, approvalsCount: req.approvals.length, threshold: req.threshold };
}
function execute(requestId, userId) {
  const req = recoveryRequests.get(requestId);
  if (!req) throw new Error("Request not found");
  req.status = "executed";
  req.executedBy = userId;
  return { ok: true, requestId, status: "executed" };
}
module.exports = { initiateRecovery, approve, execute };
