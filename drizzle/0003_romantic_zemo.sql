ALTER TABLE "activation_records" ADD COLUMN "customer_email" varchar(100);--> statement-breakpoint
ALTER TABLE "activation_records" ADD COLUMN "subscription_number" varchar(50);--> statement-breakpoint
ALTER TABLE "activation_records" ADD COLUMN "activation_number" varchar(50);--> statement-breakpoint
ALTER TABLE "activation_records" ADD COLUMN "previous_carrier" varchar(100);