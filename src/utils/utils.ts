export let isServiceReady = false;

export async function initService() {
  await checkDbConn();
  await runMigs();
  await verifyDb();
  isServiceReady = true;
}

async function checkDbConn() {}

async function runMigs() {}

async function verifyDb() {}
