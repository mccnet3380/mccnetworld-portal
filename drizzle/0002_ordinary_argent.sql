CREATE TABLE "activation_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer,
	"reception_datetime" timestamp,
	"activation_datetime" timestamp NOT NULL,
	"request_channel" varchar(50),
	"channel" varchar(100) NOT NULL,
	"customer_name" varchar(100),
	"customer_phone" varchar(20),
	"reception_number" varchar(50),
	"contact_code" varchar(50),
	"mcc_code" varchar(20),
	"dealer_registration_id" integer,
	"dealer_name" varchar(255),
	"sim_count" integer,
	"plan_name" varchar(200),
	"customer_type" varchar(20),
	"bundle_type" varchar(100),
	"add_service" varchar(200),
	"reg_fee_type" varchar(50),
	"receptionist" varchar(100),
	"policy_version_id" integer,
	"source" varchar(20) DEFAULT '수동입력' NOT NULL,
	"memo" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "carrier_service_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"carrier" varchar(100) NOT NULL,
	"policy_name" varchar(200) NOT NULL,
	"policy_type" varchar(20) NOT NULL,
	"service_category" varchar(50) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"effective_from" timestamp DEFAULT now(),
	"effective_until" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_version_id" integer NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_path" varchar(500) NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"file_size" integer,
	"memo" text,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "policy_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_version_id" integer NOT NULL,
	"channel" varchar(100) NOT NULL,
	"plan_name" varchar(200) NOT NULL,
	"customer_type" varchar(20) NOT NULL,
	"sim_count" integer,
	"bundle_type" varchar(100),
	"add_service" varchar(200),
	"reg_fee_type" varchar(50),
	"rebate_amount" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true,
	"memo" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "policy_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy_no" varchar(50) NOT NULL,
	"policy_name" varchar(200) NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"is_active" boolean DEFAULT true,
	"memo" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "policy_versions_policy_no_unique" UNIQUE("policy_no")
);
--> statement-breakpoint
CREATE TABLE "settlement_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"settlement_item_id" integer NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"file_path" varchar(500) NOT NULL,
	"file_type" varchar(20) NOT NULL,
	"file_size" integer,
	"memo" text,
	"uploaded_by" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "settlement_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"activation_id" integer NOT NULL,
	"policy_version_id" integer,
	"policy_row_id" integer,
	"dealer_registration_id" integer,
	"dealer_name" varchar(255),
	"rebate_amount" numeric(10, 2),
	"adjusted_amount" numeric(10, 2),
	"locked_amount" numeric(10, 2),
	"locked_at" timestamp,
	"locked_by" integer,
	"match_status" varchar(30) DEFAULT 'POLICY_NOT_FOUND' NOT NULL,
	"status" varchar(20) DEFAULT '미정산' NOT NULL,
	"force_policy_version_id" integer,
	"force_reason" text,
	"policy_snapshot_json" jsonb,
	"settled_at" timestamp,
	"settled_by" integer,
	"memo" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "contact_codes" ADD COLUMN "dealer_registration_id" integer;--> statement-breakpoint
ALTER TABLE "dealer_registrations" ADD COLUMN "dealer_code" varchar(20);--> statement-breakpoint
ALTER TABLE "dealer_registrations" ADD COLUMN "is_hidden_pos" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "dealer_registrations" ADD COLUMN "settlement_only" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "activated_by_type" varchar(20);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dealer_registration_id" integer;--> statement-breakpoint
ALTER TABLE "activation_records" ADD CONSTRAINT "activation_records_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_records" ADD CONSTRAINT "activation_records_dealer_registration_id_dealer_registrations_id_fk" FOREIGN KEY ("dealer_registration_id") REFERENCES "public"."dealer_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activation_records" ADD CONSTRAINT "activation_records_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_files" ADD CONSTRAINT "policy_files_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_rows" ADD CONSTRAINT "policy_rows_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_files" ADD CONSTRAINT "settlement_files_settlement_item_id_settlement_items_id_fk" FOREIGN KEY ("settlement_item_id") REFERENCES "public"."settlement_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_activation_id_activation_records_id_fk" FOREIGN KEY ("activation_id") REFERENCES "public"."activation_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_policy_row_id_policy_rows_id_fk" FOREIGN KEY ("policy_row_id") REFERENCES "public"."policy_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_dealer_registration_id_dealer_registrations_id_fk" FOREIGN KEY ("dealer_registration_id") REFERENCES "public"."dealer_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_items" ADD CONSTRAINT "settlement_items_force_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("force_policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activation_records_activation_datetime_idx" ON "activation_records" USING btree ("activation_datetime");--> statement-breakpoint
CREATE INDEX "activation_records_dealer_datetime_idx" ON "activation_records" USING btree ("dealer_registration_id","activation_datetime");--> statement-breakpoint
CREATE INDEX "activation_records_contact_code_idx" ON "activation_records" USING btree ("contact_code");--> statement-breakpoint
CREATE INDEX "activation_records_document_id_idx" ON "activation_records" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "policy_rows_version_channel_plan_idx" ON "policy_rows" USING btree ("policy_version_id","channel","plan_name");--> statement-breakpoint
CREATE INDEX "policy_rows_version_channel_plan_sim_idx" ON "policy_rows" USING btree ("policy_version_id","channel","plan_name","sim_count");--> statement-breakpoint
CREATE INDEX "settlement_items_activation_id_idx" ON "settlement_items" USING btree ("activation_id");--> statement-breakpoint
CREATE INDEX "settlement_items_dealer_status_idx" ON "settlement_items" USING btree ("dealer_registration_id","status");--> statement-breakpoint
CREATE INDEX "settlement_items_match_status_idx" ON "settlement_items" USING btree ("match_status");--> statement-breakpoint
CREATE INDEX "settlement_items_locked_at_idx" ON "settlement_items" USING btree ("locked_at");--> statement-breakpoint
ALTER TABLE "contact_codes" ADD CONSTRAINT "contact_codes_dealer_registration_id_dealer_registrations_id_fk" FOREIGN KEY ("dealer_registration_id") REFERENCES "public"."dealer_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_dealer_registration_id_dealer_registrations_id_fk" FOREIGN KEY ("dealer_registration_id") REFERENCES "public"."dealer_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_registrations" ADD CONSTRAINT "dealer_registrations_dealer_code_unique" UNIQUE("dealer_code");