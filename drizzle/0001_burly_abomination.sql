CREATE TABLE "auth_sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"user_type" varchar(20) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "other_business_carriers" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_request_point" varchar(200) NOT NULL,
	"memo" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "user_type" varchar(20) NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "expires_at" timestamp NOT NULL;