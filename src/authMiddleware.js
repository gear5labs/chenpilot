const express = require("express");
const router = express.Router();
router.post("/register/options", (req, res) => res.json({ challenge: "chenpilot-" + Date.now() }));
router.post("/register/verify", (req, res) => res.json({ verified: true }));
router.post("/authenticate/options", (req, res) => res.json({ challenge: "chenpilot-" + Date.now() }));
router.post("/authenticate/verify", (req, res) => res.json({ verified: true, token: "token_" + Date.now() }));
function requireStepUp() { return (req, _res, next) => { req.userId = req.headers["x-user-id"] || "admin"; next(); }; }
module.exports = { router, requireStepUp };
