import dotenv from "dotenv";

dotenv.config({ quiet: true });

const dbURL = process.env.DATABASE_URL!;
const mainPort = process.env.PORT!;
const platform = process.env.PLATFORM!;

const envs = {
  dbURL,
  mainPort,
  platform,
};

export default envs;
