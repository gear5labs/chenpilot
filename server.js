const express = require("express");
const path = require("path");
const fs = require("fs");
const { router: stepUpRouter, requireStepUp } = require("./src/authMiddleware");
const credentialStore = require("./src/credentialStore");
const recovery = require("./src/recovery");

const app = express();
app.use(express.json());

let currentPreferences = { currency: "USD", priceAlerts: true, txNotifications: true, marketDigest: false, updatedAt: new Date().toISOString() };
const userPreferencesMap = new Map();

if (fs.existsSync(path.join(__dirname, "public"))) {
  app.use(express.static(path.join(__dirname, "public")));
}

app.get("/health", (_req, res) => res.json({ ok: true, status: "healthy", name: "Chen Pilot", timestamp: new Date().toISOString() }));
app.get("/api/preferences", (_req, res) => res.json({ success: true, data: currentPreferences }));
app.post("/api/preferences", (req, res) => {
  currentPreferences = { ...currentPreferences, ...req.body, updatedAt: new Date().toISOString() };
  res.json({ success: true, message: "Preferences updated", data: currentPreferences });
});

app.use("/auth/webauthn", stepUpRouter);
app.post("/admin/policy", requireStepUp(), (req, res) => res.json({ ok: true, user: req.userId }));
app.post("/admin/credentials/:userId/remove", requireStepUp(), (req, res) => { credentialStore.removeCredential(req.params.userId); res.json({ ok: true }); });
app.get("/audit", requireStepUp(), (_req, res) => res.json(credentialStore.listAuditLog()));

app.post("/recovery/initiate", requireStepUp(), (req, res) => res.json(recovery.initiateRecovery(req.body)));
app.post("/recovery/approve", requireStepUp(), async (req, res) => {
  try { res.json(await recovery.approve(req.body.requestId, req.body.userId)); } catch (err) { res.status(400).json({ error: err.message }); }
});
app.post("/recovery/execute", requireStepUp(), (req, res) => {
  try { res.json(recovery.execute(req.body.requestId, req.body.userId)); } catch (err) { res.status(400).json({ error: err.message }); }
});

app.use((req, res, next) => {
  if (req.method === "GET" && req.accepts("html") && fs.existsSync(path.join(__dirname, "public", "index.html"))) {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } else { next(); }
});

module.exports = app;

if (require.main === module) {
  const port = parseInt(process.env.PORT || "3000", 10);
  const host = "0.0.0.0";
  app.listen(port, host, () => console.log("Chen Pilot running at http://" + host + ":" + port));
}
