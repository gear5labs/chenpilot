/**
 * x402 Automated Smart Contract Security Audit
 * 
 * This script scans the 'contracts' directory for Solidity files and performs
 * a heuristic security audit using the Money Machine x402 API.
 * 
 * Requirements:
 * - Node.js 18+ (uses native fetch)
 * - GitHub Secret: X402_TOKEN (Bearer token) OR X402_PAYMENT_PROOF (SOL Tx Hash)
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Configuration
const API_ENDPOINT = 'https://money-machine-x402-ssyopros.zocomputer.io/api/smart-contract-audit';
const X402_TOKEN = process.env.X402_TOKEN;
const PAYMENT_PROOF = process.env.X402_PAYMENT_PROOF;
const SCORE_THRESHOLD = 75; // Minimum passing score

/**
 * Recursively find all Solidity files in a directory
 */
async function getSolidityFiles(dir) {
    let results = [];
    try {
        const list = await fs.readdir(dir, { withFileTypes: true });
        for (const file of list) {
            const res = path.resolve(dir, file.name);
            if (file.isDirectory()) {
                results = results.concat(await getSolidityFiles(res));
            } else if (file.name.endsWith('.sol')) {
                results.push(res);
            }
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`[WARN] Directory not found: ${dir}`);
        } else {
            throw error;
        }
    }
    return results;
}

/**
 * Perform audit on a single file
 */
async function auditFile(filePath, contractsBaseDir) {
    const fileName = path.relative(contractsBaseDir, filePath);
    const content = await fs.readFile(filePath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');

    const url = `${API_ENDPOINT}?address=${hash}`;
    const headers = { 'Content-Type': 'application/json' };

    if (X402_TOKEN) {
        headers['Authorization'] = `Bearer ${X402_TOKEN}`;
    } else if (PAYMENT_PROOF) {
        headers['x-payment-proof'] = PAYMENT_PROOF;
    }

    process.stdout.write(`Auditing ${fileName}... `);

    try {
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            const status = response.status;
            let detail = '';
            try {
                const err = await response.json();
                detail = err.detail || err.error || 'Unknown error';
            } catch {
                detail = await response.text();
            }

            console.log('FAILED');
            return {
                fileName,
                success: false,
                status,
                detail: status === 402 ? 'Payment Required (Check X402 secrets)' : detail
            };
        }

        const report = await response.json();
        console.log(`DONE (Score: ${report.audit_score}/100)`);
        return {
            fileName,
            success: true,
            report
        };
    } catch (error) {
        console.log('ERROR');
        return {
            fileName,
            success: false,
            detail: error.message
        };
    }
}

/**
 * Main Execution
 */
async function main() {
    console.log('==================================================');
    console.log('   x402 Security Audit - Execution Started');
    console.log('==================================================\n');

    const contractsDir = path.join(process.cwd(), 'contracts');
    const files = await getSolidityFiles(contractsDir);

    if (files.length === 0) {
        console.log('No Solidity contracts found to audit.');
        process.exit(0);
    }

    console.log(`Targeting ${files.length} contracts for heuristic analysis...\n`);

    const results = [];
    for (const file of files) {
        results.push(await auditFile(file, contractsDir));
    }

    console.log('\n==================================================');
    console.log('               AUDIT SUMMARY');
    console.log('==================================================\n');

    let allPassed = true;
    const summary = results.map(res => {
        if (!res.success) {
            allPassed = false;
            return `[FAIL] ${res.fileName}: ${res.detail}`;
        }
        
        const isPassed = res.report.audit_score >= SCORE_THRESHOLD;
        if (!isPassed) allPassed = false;

        const statusLabel = isPassed ? 'PASS' : 'FAIL';
        let findingsSummary = '';
        if (res.report.findings?.length > 0) {
            findingsSummary = `\n       Findings: ${res.report.findings.length} issues (${res.report.security_status})`;
        }

        return `[${statusLabel}] ${res.fileName} - Score: ${res.report.audit_score}/100${findingsSummary}`;
    });

    summary.forEach(line => console.log(line));

    console.log('\n==================================================');
    if (allPassed) {
        console.log('   STATUS: ALL CONTRACTS PASSED SECURITY AUDIT');
        console.log('==================================================');
        process.exit(0);
    } else {
        console.log('   STATUS: SECURITY AUDIT FAILED - ACTION REQUIRED');
        console.log('==================================================');
        process.exit(1);
    }
}

main().catch(error => {
    console.error(`[FATAL] Script execution failed: ${error.message}`);
    process.exit(1);
});
