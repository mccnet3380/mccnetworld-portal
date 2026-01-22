CREATE TABLE "additional_services" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"carrier" varchar(100) NOT NULL,
	"monthly_fee" numeric(10, 2) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(50) NOT NULL,
	"password" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "admins_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "carriers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"is_wired" boolean DEFAULT false,
	"bundle_number" varchar(100),
	"bundle_carrier" varchar(100),
	"document_required" boolean DEFAULT false,
	"require_customer_name" boolean DEFAULT true,
	"require_customer_phone" boolean DEFAULT true,
	"require_customer_email" boolean DEFAULT false,
	"require_contact_code" boolean DEFAULT true,
	"require_carrier" boolean DEFAULT true,
	"require_previous_carrier" boolean DEFAULT false,
	"require_document_upload" boolean DEFAULT false,
	"require_bundle_number" boolean DEFAULT false,
	"require_bundle_carrier" boolean DEFAULT false,
	"allow_new_customer" boolean DEFAULT true,
	"allow_port_in" boolean DEFAULT true,
	"require_desired_number" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"chat_room_id" integer NOT NULL,
	"sender_id" integer NOT NULL,
	"sender_type" varchar(20) NOT NULL,
	"sender_name" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"message_type" varchar(20) DEFAULT 'text',
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chat_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"dealer_id" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_code_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"manager_id" integer NOT NULL,
	"carrier" varchar(50) NOT NULL,
	"contact_code" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "contact_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"dealer_name" varchar(255) NOT NULL,
	"real_sales_pos" varchar(255),
	"carrier" varchar(100) NOT NULL,
	"sales_manager_id" integer,
	"sales_manager_name" varchar(100),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "contact_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "dealer_registrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_name" varchar(255) NOT NULL,
	"representative_name" varchar(100) NOT NULL,
	"business_number" varchar(20) NOT NULL,
	"contact_phone" varchar(20) NOT NULL,
	"contact_email" varchar(100) NOT NULL,
	"address" text NOT NULL,
	"bank_account" varchar(100),
	"bank_name" varchar(50),
	"account_holder" varchar(100),
	"username" varchar(50) NOT NULL,
	"password" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT '대기' NOT NULL,
	"approved_by" integer,
	"approved_at" timestamp,
	"rejection_reason" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "dealer_registrations_business_number_unique" UNIQUE("business_number"),
	CONSTRAINT "dealer_registrations_contact_email_unique" UNIQUE("contact_email"),
	CONSTRAINT "dealer_registrations_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"dealer_id" integer,
	"user_id" integer NOT NULL,
	"document_number" varchar(50) NOT NULL,
	"customer_name" varchar(100) NOT NULL,
	"customer_phone" varchar(20) NOT NULL,
	"customer_email" varchar(100),
	"store_name" varchar(255),
	"contact_code" varchar(50),
	"carrier" varchar(100) NOT NULL,
	"previous_carrier" varchar(100),
	"customer_type" varchar(20) DEFAULT 'new',
	"desired_number" varchar(20),
	"status" varchar(20) DEFAULT '접수' NOT NULL,
	"activation_status" varchar(20) DEFAULT '대기' NOT NULL,
	"file_path" varchar(500),
	"file_name" varchar(255),
	"file_size" integer,
	"uploaded_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"activated_at" timestamp,
	"activated_by" integer,
	"cancelled_by" integer,
	"cancelled_at" timestamp,
	"notes" text,
	"assigned_worker_id" integer,
	"assigned_at" timestamp,
	"supplement_required" text,
	"supplement_notes" text,
	"supplement_required_by" integer,
	"supplement_required_at" timestamp,
	"service_plan_id" integer,
	"service_plan_name" varchar(200),
	"additional_service_ids" text,
	"registration_fee" numeric(10, 2),
	"registration_fee_prepaid" boolean DEFAULT false,
	"registration_fee_postpaid" boolean DEFAULT false,
	"registration_fee_installment" boolean DEFAULT false,
	"sim_fee_prepaid" boolean DEFAULT false,
	"sim_fee_postpaid" boolean DEFAULT false,
	"bundle_applied" boolean DEFAULT false,
	"bundle_not_applied" boolean DEFAULT false,
	"bundle_discount" numeric(10, 2),
	"total_monthly_fee" numeric(10, 2),
	"device_model" varchar(100),
	"device_serial_number" varchar(100),
	"sim_number" varchar(50),
	"subscription_number" varchar(50),
	"dealer_notes" text,
	"discard_reason" text,
	"settlement_new_customer_price" numeric(10, 2),
	"settlement_port_in_price" numeric(10, 2),
	"settlement_calculated_at" timestamp,
	"settlement_amount" numeric(10, 2),
	CONSTRAINT "documents_document_number_unique" UNIQUE("document_number")
);
--> statement-breakpoint
CREATE TABLE "hidden_prices_by_pos" (
	"id" serial PRIMARY KEY NOT NULL,
	"contact_code" varchar(50) NOT NULL,
	"service_plan_id" integer NOT NULL,
	"hidden_price" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true,
	"effective_from" timestamp DEFAULT now(),
	"effective_until" timestamp,
	"memo" text,
	"created_by" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "other_carriers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"display_order" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"description" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sales_managers" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_id" integer NOT NULL,
	"manager_name" varchar(100) NOT NULL,
	"manager_code" varchar(20) NOT NULL,
	"username" varchar(50) NOT NULL,
	"password" varchar(255) NOT NULL,
	"position" varchar(20) DEFAULT '대리' NOT NULL,
	"contact_phone" varchar(20),
	"email" varchar(100),
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sales_managers_manager_code_unique" UNIQUE("manager_code"),
	CONSTRAINT "sales_managers_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "sales_teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_name" varchar(100) NOT NULL,
	"team_code" varchar(20) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "sales_teams_team_code_unique" UNIQUE("team_code")
);
--> statement-breakpoint
CREATE TABLE "service_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"carrier" varchar(100) NOT NULL,
	"plan_type" varchar(50) NOT NULL,
	"data_allowance" varchar(100),
	"monthly_fee" numeric(10, 2) NOT NULL,
	"combination_eligible" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_unit_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_plan_id" integer NOT NULL,
	"new_customer_price" numeric(10, 2) NOT NULL,
	"port_in_price" numeric(10, 2) NOT NULL,
	"is_active" boolean DEFAULT true,
	"effective_from" timestamp DEFAULT now(),
	"effective_until" timestamp,
	"memo" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"created_by" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"dealer_id" integer,
	"username" varchar(50) NOT NULL,
	"password" varchar(255) NOT NULL,
	"name" varchar(100) NOT NULL,
	"user_type" varchar(20) DEFAULT 'user' NOT NULL,
	"role" varchar(50),
	"allowed_carriers" jsonb,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_room_id_chat_rooms_id_fk" FOREIGN KEY ("chat_room_id") REFERENCES "public"."chat_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_code_mappings" ADD CONSTRAINT "contact_code_mappings_manager_id_sales_managers_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."sales_managers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_codes" ADD CONSTRAINT "contact_codes_sales_manager_id_sales_managers_id_fk" FOREIGN KEY ("sales_manager_id") REFERENCES "public"."sales_managers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_registrations" ADD CONSTRAINT "dealer_registrations_approved_by_admins_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_service_plan_id_service_plans_id_fk" FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_managers" ADD CONSTRAINT "sales_managers_team_id_sales_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."sales_teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_unit_prices" ADD CONSTRAINT "settlement_unit_prices_service_plan_id_service_plans_id_fk" FOREIGN KEY ("service_plan_id") REFERENCES "public"."service_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hidden_prices_contact_code_service_plan_idx" ON "hidden_prices_by_pos" USING btree ("contact_code","service_plan_id");--> statement-breakpoint
CREATE INDEX "hidden_prices_effective_from_idx" ON "hidden_prices_by_pos" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");