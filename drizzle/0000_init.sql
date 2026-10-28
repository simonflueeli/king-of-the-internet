CREATE TABLE "admin_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"props" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banned_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "banned_terms_term_unique" UNIQUE("term")
);
--> statement-breakpoint
CREATE TABLE "bans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"value_hash" text NOT NULL,
	"reason" text,
	"expires_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"alert_opt_in" boolean DEFAULT false NOT NULL,
	"alert_opt_in_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"type" text NOT NULL,
	"throne_id" text,
	"reign_id" uuid,
	"provider_message_id" text,
	"status" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid,
	"field" text NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_text" text NOT NULL,
	"result" text NOT NULL,
	"category" text,
	"model" text NOT NULL,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"stripe_payment_intent_id" text NOT NULL,
	"stripe_charge_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"status" text NOT NULL,
	"fee_cents" integer,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"disputed" boolean DEFAULT false NOT NULL,
	"card_fingerprint" text,
	"card_country" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_stripePaymentIntentId_unique" UNIQUE("stripe_payment_intent_id")
);
--> statement-breakpoint
CREATE TABLE "reigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"throne_id" text NOT NULL,
	"customer_id" uuid,
	"name" text NOT NULL,
	"proclamation" text,
	"paid_cents" integer NOT NULL,
	"title" text NOT NULL,
	"crest_seed" bigint NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"blurred" boolean DEFAULT false NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reign_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"reporter_ip_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"throne_id" text NOT NULL,
	"min_cents" integer NOT NULL,
	"amount_cents" integer,
	"throne_version" integer NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"fail_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paying_at" timestamp with time zone,
	"client_ip_hash" text,
	"device_id" text,
	"reservation_token_hash" text NOT NULL,
	"source" text DEFAULT 'button' NOT NULL,
	"payment_intent_id" text,
	"name" text,
	"proclamation" text,
	"email" text,
	"alert_opt_in" boolean DEFAULT false NOT NULL,
	"terms_accepted_at" timestamp with time zone,
	"reign_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "thrones" (
	"id" text PRIMARY KEY NOT NULL,
	"current_reign_id" uuid,
	"last_paid_cents" integer,
	"crowned_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_credentials" ADD CONSTRAINT "admin_credentials_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reigns" ADD CONSTRAINT "reigns_throne_id_thrones_id_fk" FOREIGN KEY ("throne_id") REFERENCES "public"."thrones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reigns" ADD CONSTRAINT "reigns_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reigns" ADD CONSTRAINT "reigns_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reign_id_reigns_id_fk" FOREIGN KEY ("reign_id") REFERENCES "public"."reigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_throne_id_thrones_id_fk" FOREIGN KEY ("throne_id") REFERENCES "public"."thrones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_name_created_idx" ON "analytics_events" USING btree ("name","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bans_kind_value_idx" ON "bans" USING btree ("kind","value_hash");--> statement-breakpoint
CREATE INDEX "email_log_customer_type_sent_idx" ON "email_log" USING btree ("customer_id","type","sent_at");--> statement-breakpoint
CREATE INDEX "moderation_checks_created_idx" ON "moderation_checks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reigns_throne_started_idx" ON "reigns" USING btree ("throne_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reports_reign_created_idx" ON "reports" USING btree ("reign_id","created_at");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_open_per_throne" ON "reservations" USING btree ("throne_id") WHERE "reservations"."state" in ('active', 'paying');--> statement-breakpoint
CREATE INDEX "reservations_state_expires_idx" ON "reservations" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "reservations_ip_created_idx" ON "reservations" USING btree ("client_ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "reservations_device_created_idx" ON "reservations" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "reservations_intent_idx" ON "reservations" USING btree ("payment_intent_id");