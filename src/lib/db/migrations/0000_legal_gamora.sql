CREATE TABLE "logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"level" varchar(10) NOT NULL,
	"service" varchar(256) NOT NULL,
	"message" varchar(512) NOT NULL,
	"attributes" jsonb
);
--> statement-breakpoint
CREATE INDEX "logs_timestamp_id_idx" ON "logs" USING btree ("timestamp","id");--> statement-breakpoint
CREATE INDEX "logs_service_timestamp_idx" ON "logs" USING btree ("service","timestamp");--> statement-breakpoint
CREATE INDEX "logs_level_timestamp_idx" ON "logs" USING btree ("level","timestamp");