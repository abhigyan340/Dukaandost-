/**
 * DukaanDost - CLI Interactive Chat Interface
 * Initializes the database, checks seed data, launches readline chat loop.
 */

const readline = require('readline');
const { getDb, getTodayDate } = require('./db');
const { seedDatabase } = require('./seed');
const { DukaanDostAgent } = require('./agent');

/**
 * Initializes database and seeds if empty.
 */
function ensureDatabaseReady() {
  const db = getDb();
  const productCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;

  if (productCount === 0) {
    console.log('[DukaanDost] Empty database detected. Seeding initial store inventory and customer records...');
    seedDatabase();
  }
}

/**
 * Prints the welcome banner for DukaanDost.
 */
function printWelcomeBanner() {
  const { fullString } = getTodayDate();
  console.log('\n================================================================');
  console.log('   🏪  DukaanDost - Kirana Store Inventory & Billing AI Agent  ');
  console.log('   Assessment Submission: AI Agent Hackathon (Task T6)         ');
  console.log('================================================================');
  console.log(`📅 Today's Date: ${fullString}`);
  console.log('\n"Namaste! Main DukaanDost hoon, aapka digital kirana sahayak.');
  console.log('Main billing, inventory, udhaar ledger, aur daily reports sambhal sakta hoon.');
  console.log('Type your question or request below. Type "exit" or "quit" to leave.\n');
  console.log('Try commands like:');
  console.log('  • "search maggi"');
  console.log('  • "How much does Sharma ji owe me?"');
  console.log('  • "Bill for Sharma ji: 2 Maggi, 1 kg sugar, 1 Amul butter - put it on udhaar."');
  console.log('  • "Which items will expire this week?"');
  console.log('  • "What were my top 5 selling items this month?"');
  console.log('----------------------------------------------------------------\n');
}

/**
 * Main chat loop.
 */
async function startCli() {
  try {
    ensureDatabaseReady();
    printWelcomeBanner();

    const agent = new DukaanDostAgent();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'You: '
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        rl.prompt();
        return;
      }

      if (['exit', 'quit', 'bye', 'alvida'].includes(input.toLowerCase())) {
        console.log('\n[DukaanDost] Dhanyawad! Have a profitable day at your store. Alvida! 🙏\n');
        process.exit(0);
      }

      // Process with DukaanDost Agent
      try {
        process.stdout.write('[DukaanDost thinking...] \r');
        const { reply, toolCallsMade } = await agent.sendMessage(input);

        // Clear thinking line
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);

        if (toolCallsMade && toolCallsMade.length > 0) {
          const toolNames = toolCallsMade.map(t => t.tool).join(', ');
          console.log(`\x1b[90m[Used tool(s): ${toolNames}]\x1b[0m`);
        }

        console.log(`\nDukaanDost:\n${reply}\n`);
      } catch (err) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.error(`\nDukaanDost encountered an unexpected error: ${err.message}\n`);
      }

      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\n[DukaanDost] Session closed. Namaste! 🙏\n');
      process.exit(0);
    });

  } catch (err) {
    console.error('Fatal initialization error:', err.message);
    process.exit(1);
  }
}

// Start CLI if run directly
if (require.main === module) {
  startCli();
}

// Keep the process alive and user-friendly on unexpected async failures.
// No stack traces, no secrets — just a short recoverable message.
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  // Suppress internal better-sqlite3 interrupt noise on clean exit
  if (msg && msg.toLowerCase().includes('this database connection is busy')) return;
  console.error('\n[DukaanDost] An unexpected background error occurred. Please try your last request again.');
});

process.on('uncaughtException', (err) => {
  console.error('\n[DukaanDost] An unexpected error occurred. The assistant is still running — please try again.');
  // Do NOT call process.exit() — keep the CLI alive where safe.
  // Only fatal I/O errors on stdin/stdout should actually kill the process.
  if (err.code === 'ERR_USE_AFTER_CLOSE' || err.code === 'EPIPE') {
    process.exit(1);
  }
});

module.exports = { startCli };
