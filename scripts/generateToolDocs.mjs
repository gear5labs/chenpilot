import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOOLS_DIR = path.join(__dirname, "../src/Agents/tools");
const OUTPUT_FILE = path.join(__dirname, "../docs/TOOLS.md");

function parseMetadata(content) {
  // Try to find the metadata block first
  const metadataBlockMatch = content.match(
    /metadata:\s*ToolMetadata\s*=\s*{([\s\S]*?)}\s*;/
  );
  const literalMatch = content.match(/export const \w+Tool = {([\s\S]*?)}\s*;/);
  const genericLiteralMatch = content.match(
    /export const \w+ = {([\s\S]*?)}\s*;/
  );

  const metaContent = metadataBlockMatch
    ? metadataBlockMatch[1]
    : literalMatch
      ? literalMatch[1]
      : genericLiteralMatch
        ? genericLiteralMatch[1]
        : content;

  const nameMatch = metaContent.match(/name:\s*["'](.+?)["']/);
  const descriptionMatch = metaContent.match(
    /description:\s*["']([\s\S]+?)["']/
  );
  const categoryMatch = metaContent.match(/category:\s*["'](.+?)["']/);
  const versionMatch = metaContent.match(/version:\s*["'](.+?)["']/);

  if (!nameMatch) return null;

  const name = nameMatch[1];
  const description = descriptionMatch
    ? descriptionMatch[1].trim().replace(/\s+/g, " ")
    : "";
  const category = categoryMatch ? categoryMatch[1] : "general";
  const version = versionMatch ? versionMatch[1] : "1.0.0";

  const parameters = {};

  // Try to find parameters block specifically within the metadata/literal
  const paramsMatch = metaContent.match(
    /parameters:\s*{([\s\S]*?)}\s*,?\s*(examples|category|version|execute|async)/
  );
  if (paramsMatch) {
    const paramsContent = paramsMatch[1];

    // Check if it uses 'properties'
    const propertiesMatch = paramsContent.match(/properties:\s*{([\s\S]*)}/);
    if (propertiesMatch) {
      const propsContent = propertiesMatch[1];
      const propRegex = /(\w+):\s*{([\s\S]*?)}/g;
      let m;
      while ((m = propRegex.exec(propsContent)) !== null) {
        const pName = m[1];
        const pBody = m[2];
        if (pName === "type" && pBody.includes("object")) continue;
        parameters[pName] = {
          type: (pBody.match(/type:\s*["'](.+?)["']/) || [])[1] || "any",
          description:
            (pBody.match(/description:\s*["'](.+?)["']/) || [])[1] || "",
          required: false,
        };
      }

      const requiredMatch = paramsContent.match(/required:\s*\[([\s\S]*?)\]/);
      if (requiredMatch) {
        requiredMatch[1].split(",").forEach((req) => {
          const reqName = req.trim().replace(/['"]/g, "");
          if (parameters[reqName]) parameters[reqName].required = true;
        });
      }
    } else {
      const paramRegex = /(\w+):\s*{([\s\S]*?)}/g;
      let m;
      while ((m = paramRegex.exec(paramsContent)) !== null) {
        const pName = m[1];
        const pBody = m[2];
        if (pName === "properties") continue;

        parameters[pName] = {
          type: (pBody.match(/type:\s*["'](.+?)["']/) || [])[1] || "any",
          description:
            (pBody.match(/description:\s*["'](.+?)["']/) || [])[1] || "",
          required:
            (pBody.match(/required:\s*(true|false)/) || [])[1] === "true",
        };
        const enumMatch = pBody.match(/enum:\s*\[([\s\S]*?)\]/);
        if (enumMatch) {
          parameters[pName].enum = enumMatch[1]
            .split(",")
            .map((e) => e.trim().replace(/['"]/g, ""));
        }
      }
    }
  }

  const examples = [];
  const examplesMatch = metaContent.match(/examples:\s*\[([\s\S]*?)\]/);
  if (examplesMatch) {
    const examplesStr = examplesMatch[1];
    // Improved example regex to handle quotes correctly
    const exampleRegex = /"([^"]+)"|'([^']+)'/g;
    let exM;
    while ((exM = exampleRegex.exec(examplesStr)) !== null) {
      examples.push((exM[1] || exM[2]).trim());
    }
  }

  return { name, description, category, version, parameters, examples };
}

function generateMarkdown(tools) {
  let md = "# Agent Tools Documentation\n\n";
  md += "This document is automatically generated. Do not edit manually.\n\n";

  md += "## Table of Contents\n\n";
  const categories = [...new Set(tools.map((t) => t.category))].sort();
  categories.forEach((cat) => {
    md += `- [${cat.toUpperCase()}](#${cat.toLowerCase()})\n`;
    tools
      .filter((t) => t.category === cat)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((t) => {
        md += `  - [${t.name}](#${t.name.toLowerCase().replace(/_/g, "-")})\n`;
      });
  });
  md += "\n---\n\n";

  categories.forEach((cat) => {
    md += `## ${cat.toUpperCase()}\n\n`;
    tools
      .filter((t) => t.category === cat)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((tool) => {
        md += `### ${tool.name}\n\n`;
        md += `${tool.description}\n\n`;
        md += `**Version:** ${tool.version}\n\n`;

        md += "#### Parameters\n\n";
        if (Object.keys(tool.parameters).length > 0) {
          md += "| Parameter | Type | Required | Description | Options |\n";
          md += "| --- | --- | --- | --- | --- |\n";
          Object.entries(tool.parameters).forEach(([name, def]) => {
            const enumStr = def.enum ? `\`${def.enum.join("`, `")}\`` : "-";
            md += `| ${name} | ${def.type} | ${def.required ? "Yes" : "No"} | ${def.description} | ${enumStr} |\n`;
          });
        } else {
          md += "No parameters defined.\n";
        }
        md += "\n";

        if (tool.examples.length > 0) {
          md += "#### Examples\n\n";
          tool.examples.forEach((ex) => {
            md += `- ${ex}\n`;
          });
          md += "\n";
        }
        md += "---\n\n";
      });
  });

  return md;
}

function main() {
  if (!fs.existsSync(TOOLS_DIR)) {
    console.error(`Tools directory not found: ${TOOLS_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(TOOLS_DIR);
  const tools = [];

  files.forEach((file) => {
    if (
      file.endsWith(".ts") &&
      !file.includes(".test.") &&
      file !== "index.ts" &&
      file !== "agent-tool.entity.ts"
    ) {
      const content = fs.readFileSync(path.join(TOOLS_DIR, file), "utf-8");
      const metadata = parseMetadata(content);
      if (metadata && metadata.name) {
        tools.push(metadata);
      }
    }
  });

  const markdown = generateMarkdown(tools);

  const docsDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, markdown);
  console.log(
    `Successfully generated documentation for ${tools.length} tools at ${OUTPUT_FILE}`
  );
}

main();
