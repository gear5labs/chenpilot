"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slashCommandDefinitions = void 0;
const discord_js_1 = require("discord.js");
exports.slashCommandDefinitions = [
    new discord_js_1.SlashCommandBuilder()
        .setName("start")
        .setDescription("Welcome message and bot introduction")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check bot latency and backend health")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("help")
        .setDescription("List available features or search for a specific one")
        .addStringOption((opt) => opt
        .setName("query")
        .setDescription("Search term to filter features")
        .setRequired(false))
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("thread")
        .setDescription("Start a dedicated support thread in this channel")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("sponsor")
        .setDescription("Request free Stellar account sponsorship (DM only for security)")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("trustline")
        .setDescription("Look up a Stellar asset trustline")
        .addStringOption((opt) => opt
        .setName("asset")
        .setDescription("Asset code, e.g. USDC")
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName("issuer")
        .setDescription("Issuer domain or address, e.g. circle.com")
        .setRequired(true))
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("dashboard")
        .setDescription("Get a link to the Chen Pilot admin dashboard")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("validate")
        .setDescription("Verify a Stellar asset for safety")
        .addStringOption((opt) => opt
        .setName("asset")
        .setDescription("Asset code, e.g. USDC")
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName("issuer")
        .setDescription("Issuer address (Stellar public key)")
        .setRequired(true))
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("multisig")
        .setDescription("Start the multi-signature wallet setup wizard (DM only)")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("currency")
        .setDescription("Set your preferred reporting currency")
        .addStringOption((opt) => opt
        .setName("currency")
        .setDescription("Currency to use for reports")
        .setRequired(true)
        .addChoices({ name: "USD", value: "USD" }, { name: "XLM", value: "XLM" }, { name: "BTC", value: "BTC" }))
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("report")
        .setDescription("Get your portfolio report in your preferred currency")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("alert")
        .setDescription("Set a price alert for a Stellar asset")
        .addStringOption((opt) => opt
        .setName("asset")
        .setDescription("Asset code, e.g. XLM")
        .setRequired(true))
        .addStringOption((opt) => opt
        .setName("condition")
        .setDescription("Trigger condition")
        .setRequired(true)
        .addChoices({ name: "above", value: "above" }, { name: "below", value: "below" }))
        .addNumberOption((opt) => opt
        .setName("price")
        .setDescription("Target price")
        .setRequired(true)
        .setMinValue(0))
        .addStringOption((opt) => opt
        .setName("currency")
        .setDescription("Currency for the price (defaults to your set currency)")
        .setRequired(false)
        .addChoices({ name: "USD", value: "USD" }, { name: "XLM", value: "XLM" }, { name: "BTC", value: "BTC" }))
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("alerts")
        .setDescription("List your active price alerts")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("advanced")
        .setDescription("Execute an advanced role-gated command")
        .toJSON(),
    new discord_js_1.SlashCommandBuilder()
        .setName("discover")
        .setDescription("Discover trending Stellar assets (requires advanced role)")
        .toJSON(),
];
