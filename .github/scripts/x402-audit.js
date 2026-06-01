const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const API_ENDPOINT = 'https://money-machine-x402-ssyopros.zocomputer.io/api/smart-contract-audit';
const X402_TOKEN = process.env.X402_TOKEN;
const PAYMENT_PROOF = process.env.X402_PAYMENT_PROOF;

async function run() {
  const contractsDir = path.join(process.cwd(), 'contracts');
  if (!fs.existsSync(contractsDir)) {
    console.log("No contracts directory found.");
    return;
  }

  // Find all .sol files recursively
  const getFiles = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      file = path.resolve(dir, file);
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
        results = results.concat(getFiles(file));
      } else {
        if (file.endsWith('.sol')) results.push(file);
      }
    });
    return results;
  };

  const files = getFiles(contractsDir);
  if (files.length === 0) {
    console.log("No .sol files found in contracts directory.");
    return;
  }

  console.log(`Found ${files.length} contracts to audit.`);

  let exitCode = 0;
  for (const filePath of files) {
    const fileName = path.relative(contractsDir, filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    
    // In a real scenario, we might upload the code. 
    // For this simulation, we use the hash as the "address".
    const url = `${API_ENDPOINT}?address=${hash}`;
    
    console.log(`Auditing ${fileName} (hash: ${hash.slice(0, 10)}...)...`);
    
    const headers = {
      'Content-Type': 'application/json'
    };
    if (X402_TOKEN) {
      headers['Authorization'] = `Bearer ${X402_TOKEN}`;
    } else if (PAYMENT_PROOF) {
      headers['x-payment-proof'] = PAYMENT_PROOF;
    }

    try {
      const response = await fetch(url, { headers });
      if (!response.ok) {
        let errDetail = '';
        try {
          const err = await response.json();
          errDetail = `${err.error} - ${err.detail || ''}`;
        } catch (e) {
          errDetail = await response.text();
        }
        
        console.error(`Error auditing ${fileName}: ${errDetail}`);
        if (response.status === 402) {
          console.error("Payment required. Please provide X402_TOKEN or X402_PAYMENT_PROOF secrets.");
        }
        exitCode = 1;
        continue;
      }

      const report = await response.json();
      printReport(fileName, report);

      if (report.audit_score < 70) {
        console.error(`[FAILURE] ${fileName} failed security audit with score ${report.audit_score}`);
        exitCode = 1;
      }
    } catch (e) {
      console.error(`Failed to call audit API for ${fileName}: ${e.message}`);
      exitCode = 1;
    }
  }

  process.exit(exitCode);
}

function printReport(file, report) {
  console.log('--------------------------------------------------');
  console.log(`Audit Report for ${file}`);
  console.log(`Status: ${report.security_status}`);
  console.log(`Score: ${report.audit_score}/100`);
  console.log(`Issues Found: ${report.total_issues_found}`);
  if (report.findings && report.findings.length > 0) {
    report.findings.forEach(f => {
      console.log(`  - [${f.severity}] ${f.name}: ${f.description}`);
    });
  }
  console.log(`Recommendation: ${report.recommendation}`);
  console.log('--------------------------------------------------');
}

run();
