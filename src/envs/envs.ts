import dotenv from "dotenv";

dotenv.config({ quiet: true });

const dbURL = process.env.DATABASE_URL!;
const mainPort = process.env.PORT!;
const retentionDays = Number(process.env.RETENTION_DAYS ?? 30);
const retentionCheckPeriodHours = Number(
  process.env.RETENTION__CHECK_PERIOD_HOURS ?? 24,
);
const retentionBatchMaxSize = Number(process.env.RETENTION_BATCH_SIZE ?? 10000);

const envs = {
  dbURL,
  mainPort,
  retentionDays,
  retentionCheckPeriodHours,
  retentionBatchMaxSize,
};

export default envs;
